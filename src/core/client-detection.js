/* ============================================================
   Per-request MCP client detection.

   Maps clientInfo.name (from the MCP initialize message) to an
   adapter id and caches the mapping so that follow-up requests
   on the same connection (tools/list, tools/call, …) resolve to
   the same adapter without a fresh initialize.

   Robustness layers, in priority order:
     1. Per-key cache (User-Agent + remote address) — best when
        the client uses HTTP keep-alive and a stable UA.
     2. "Last initialize seen on this server" fallback — handles
        clients that open a new TCP connection per request, omit
        a User-Agent, or have a UA that differs between init and
        tool calls. Correct for single-client dev, deliberately
        ambiguous for the multi-client case.
     3. Static `fallback` (defaults to "generic", overridable
        via TASKBRIDGE_AGENT_ID).
     4. Tool-level `agent_id` argument always wins above all of
        these — that's the explicit-override contract for clients
        that want a stable per-task tag.
   ============================================================ */

/**
 * Substring-pattern matchers in priority order. The first regex that
 * matches the normalized clientInfo.name wins. Patterns are deliberately
 * fuzzy so future variants ("Codex Desktop", "openai-codex-2",
 * "AntigravityIDE", …) don't need a code change.
 *
 * The same patterns are used as a User-Agent fallback when a request
 * arrives without a clear clientInfo.name (e.g. Codex Desktop has been
 * observed sending the MCP initialize without a populated `clientInfo`
 * but with a recognisable HTTP `User-Agent`).
 */
const CLIENT_PATTERNS = Object.freeze([
  // Specific, multi-word names first so they don't get shadowed by single-word patterns.
  { pattern: /antigravity/i,            adapter: "antigravity" },
  { pattern: /claude[-_ ]?desktop/i,    adapter: "claude-desktop" },
  { pattern: /claude[-_ ]?code/i,       adapter: "claude-code" },
  { pattern: /claude[-_ ]?cowork/i,     adapter: "claude-cowork" },
  // Codex covers "codex", "codex-mcp-client", "Codex Desktop",
  // "openai-codex", "openai-codex-cli", and any future variant.
  { pattern: /codex/i,                  adapter: "codex" },
  // Anthropic SDK's default client name. Catches Cowork, Claude
  // Desktop's MCP layer, Claude Code's MCP layer — all of which
  // self-identify as "Anthropic" unless the client overrides.
  { pattern: /anthropic/i,              adapter: "claude-cowork" },
  // OpenAI fallback (matches "openai-mcp-client" and similar non-Codex
  // OpenAI tooling). Mapped to codex as the closest known adapter.
  { pattern: /openai/i,                 adapter: "codex" },
]);

/** Match against an arbitrary string (UA / clientInfo.name). Returns null on no match. */
const matchPatterns = (raw) => {
  if (!raw) return null;
  for (const { pattern, adapter } of CLIENT_PATTERNS) {
    if (pattern.test(raw)) return adapter;
  }
  return null;
};

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const adapterForClientName = (clientName, fallback = "generic") => {
  const raw = String(clientName || "").trim();
  if (!raw) return fallback;
  return matchPatterns(raw) || matchPatterns(normalize(raw)) || fallback;
};

/** Pull the best adapter id from an HTTP request's User-Agent header. */
export const adapterForUserAgent = (userAgent, fallback = null) => {
  return matchPatterns(String(userAgent || "")) || fallback;
};

const CACHE_MAX = 256;

const keyForRequest = (req) => {
  const ua = req?.headers?.["user-agent"] || "";
  const ip = req?.ip || req?.socket?.remoteAddress || "";
  return `${ua}|${ip}`;
};

const extractInitialize = (body) => {
  if (!body) return null;
  if (Array.isArray(body)) return body.find((m) => m && m.method === "initialize") || null;
  return body.method === "initialize" ? body : null;
};

/**
 * Creates a per-process client tracker.
 *
 * fallback — adapter id used when no detection / cache hit. Typically
 *            comes from TASKBRIDGE_AGENT_ID.
 * logger   — optional `{ info(msg, meta) }` for visibility on every detection.
 *            Pass `console` or our structured logger; defaults to no-op.
 */
export const createClientTracker = ({ fallback = "generic", logger = null } = {}) => {
  const cache = new Map(); // insertion-ordered, capped at CACHE_MAX
  let lastInitAdapter = null; // server-wide most-recent initialize result
  let lastInitClientName = null;

  const log = (level, msg, meta) => {
    if (logger && typeof logger[level] === "function") logger[level](msg, meta);
  };

  const remember = (key, adapterId) => {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, adapterId);
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  };

  return {
    fallback,
    /** Internal — exposed for tests only. */
    _cache: cache,
    get lastInitAdapter() { return lastInitAdapter; },
    get lastInitClientName() { return lastInitClientName; },

    /**
     * Inspect an incoming request. We look at, in order of preference:
     *   1. The clientInfo.name in an MCP `initialize` message body.
     *   2. The HTTP User-Agent header (covers clients like Codex Desktop
     *      that have been observed sending initialize without a populated
     *      clientInfo but with a recognisable UA).
     * Whichever produces a hit is cached for this request's key AND
     * remembered as the server-wide most-recent. Returns the resolved
     * adapter id, or null if nothing matched.
     */
    observe(req, body) {
      const ua = req?.headers?.["user-agent"] || null;
      const ip = req?.ip || req?.socket?.remoteAddress || null;
      const msg = extractInitialize(body);
      const clientName = msg?.params?.clientInfo?.name || null;

      let adapterId = null;
      let source = null;
      if (clientName) {
        const fromName = matchPatterns(clientName);
        if (fromName) {
          adapterId = fromName;
          source = "clientInfo.name";
        }
      }
      if (!adapterId && msg) {
        // We saw an initialize but clientInfo.name was useless — try the UA.
        const fromUa = matchPatterns(ua);
        if (fromUa) {
          adapterId = fromUa;
          source = "user-agent";
        }
      }
      if (!adapterId) return null;

      const key = keyForRequest(req);
      remember(key, adapterId);
      lastInitAdapter = adapterId;
      lastInitClientName = clientName || ua || null;
      log("info", "mcp client detected", {
        source, clientName, ua, ip, adapterId,
      });
      return adapterId;
    },

    /**
     * Resolve the best-known adapter id for this request, in priority order:
     *   1. Per-key cache (this connection's own initialize).
     *   2. User-Agent pattern-match on the *current* request (catches
     *      tool calls that arrive on a fresh TCP connection without
     *      a prior initialize whose cache entry survived).
     *   3. Server-wide most-recent initialize.
     *   4. Static fallback.
     */
    resolve(req) {
      const cached = cache.get(keyForRequest(req));
      if (cached) return cached;
      const fromUa = adapterForUserAgent(req?.headers?.["user-agent"]);
      if (fromUa) {
        log("info", "mcp client resolved via user-agent", {
          ua: req?.headers?.["user-agent"],
          adapterId: fromUa,
        });
        return fromUa;
      }
      if (lastInitAdapter) return lastInitAdapter;
      log("info", "mcp client fallback", { adapterId: fallback });
      return fallback;
    },
  };
};
