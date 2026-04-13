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

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const adapterForClientName = (clientName, fallback = "generic") => {
  const raw = String(clientName || "").trim();
  if (!raw) return fallback;
  for (const { pattern, adapter } of CLIENT_PATTERNS) {
    if (pattern.test(raw)) return adapter;
  }
  // Try the normalized form as a last resort — catches odd
  // separators ("Codex.Desktop", "claude_cowork") that the
  // unanchored regexes already handle, but keeps the contract
  // explicit for callers that depend on it.
  const normalized = normalize(raw);
  for (const { pattern, adapter } of CLIENT_PATTERNS) {
    if (pattern.test(normalized)) return adapter;
  }
  return fallback;
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
     * Inspect an incoming request body. If it contains an MCP `initialize`
     * message with clientInfo.name, map it to an adapter id, cache it,
     * and remember it as the server-wide most-recent. Returns the resolved
     * adapter id (or null if this wasn't an initialize).
     */
    observe(req, body) {
      const msg = extractInitialize(body);
      if (!msg) return null;
      const clientName = msg?.params?.clientInfo?.name;
      if (!clientName) return null;
      const adapterId = adapterForClientName(clientName, fallback);
      const key = keyForRequest(req);
      remember(key, adapterId);
      lastInitAdapter = adapterId;
      lastInitClientName = clientName;
      log("info", "mcp client detected", {
        clientName,
        adapterId,
        ua: req?.headers?.["user-agent"] || null,
        ip: req?.ip || req?.socket?.remoteAddress || null,
      });
      return adapterId;
    },

    /**
     * Resolve the best-known adapter id for this request, in priority order:
     *   1. Per-key cache (this connection's own initialize).
     *   2. Server-wide most-recent initialize (catches clients that open
     *      a fresh TCP connection per request, omit a User-Agent, or
     *      otherwise change their cache key between init and tool call).
     *   3. Static fallback.
     */
    resolve(req) {
      const cached = cache.get(keyForRequest(req));
      if (cached) return cached;
      if (lastInitAdapter) return lastInitAdapter;
      return fallback;
    },
  };
};
