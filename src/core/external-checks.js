import { spawn } from "node:child_process";

/* ============================================================
   Dynamic liveness probes for external tools the web server
   can observe but doesn't own. Hardcoded list — no config.
   Every /api/health request runs these in parallel.
   Levels: "ok" | "warn" | "off" | "bad"
     ok   — responding correctly
     warn — reachable but degraded
     off  — not running (expected absence)
     bad  — running but failing unexpectedly
   ============================================================ */

const DEFAULT_MCP_PROBE_TIMEOUT = 1500;
const DEFAULT_PROCESS_PROBE_TIMEOUT = 1000;

const now = () => Date.now();

/** POST an MCP initialize and look for the taskbridge server handshake. */
export const probeMcpHttp = async (url, timeoutMs = DEFAULT_MCP_PROBE_TIMEOUT) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "tb-healthcheck", version: "0" },
        },
      }),
      signal: controller.signal,
    });
    const elapsed = now() - start;
    if (!res.ok) {
      return { level: "bad", message: `HTTP ${res.status}`, responseMs: elapsed };
    }
    const text = await res.text();
    const isTaskbridge = text.includes('"mcp-taskbridge"');
    return isTaskbridge
      ? { level: "ok", message: "initialize ok", responseMs: elapsed }
      : { level: "warn", message: "reachable but not a taskbridge server", responseMs: elapsed };
  } catch (err) {
    if (err.name === "AbortError") return { level: "off", message: "timeout", responseMs: timeoutMs };
    if (err.cause?.code === "ECONNREFUSED" || err.code === "ECONNREFUSED") {
      return { level: "off", message: "connection refused (not running)", responseMs: now() - start };
    }
    return { level: "bad", message: err.message, responseMs: now() - start };
  } finally {
    clearTimeout(timer);
  }
};

/** Is a process matching this pattern alive? Uses pgrep on Unix. */
export const probeProcess = (pattern, timeoutMs = DEFAULT_PROCESS_PROBE_TIMEOUT) =>
  new Promise((resolve) => {
    const start = now();
    let child;
    try {
      child = spawn("pgrep", ["-f", pattern], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return resolve({ level: "off", message: "pgrep unavailable on this OS", responseMs: 0 });
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ level: "off", message: "pgrep timeout", responseMs: now() - start });
    }, timeoutMs);

    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ level: "off", message: "pgrep failed", responseMs: now() - start });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const elapsed = now() - start;
      if (code === 0) {
        const pids = stdout.trim().split(/\s+/).filter(Boolean);
        resolve({ level: "ok", message: `${pids.length} process${pids.length === 1 ? "" : "es"} running`, responseMs: elapsed });
      } else {
        resolve({ level: "off", message: "not running", responseMs: elapsed });
      }
    });
  });

/* ---------- The hardcoded check list ---------- */

const MCP_STATUS_MAP = {
  active:  { level: "ok",   message: "recent signed webhook — client is live and the shared secret is correct" },
  idle:    { level: "warn", message: "no activity in the last 5 minutes — may just be waiting for work" },
  unknown: { level: "off",  message: "no signed webhook ever received on this boot" },
};

export const DEFAULT_CHECKS = [
  {
    id: "supergateway",
    label: "Supergateway (stdio → HTTP)",
    hint: "Wraps bin/mcp.js so cloud MCP clients (Cowork / Codex HTTP) can reach it. Expected at http://127.0.0.1:8000/mcp.",
    kind: "mcp-http",
    probe: () => probeMcpHttp("http://127.0.0.1:8000/mcp"),
  },
  {
    id: "cloudflared",
    label: "Cloudflare tunnel",
    hint: "Public HTTPS tunnel to the supergateway. Required for Claude Cowork / anything reaching in from the cloud.",
    kind: "process",
    probe: () => probeProcess("cloudflared tunnel"),
  },
  {
    id: "mcp-clients",
    label: "Stdio MCP clients",
    hint: "Claude Desktop / Codex / Antigravity — the web server can't probe these directly; status is inferred from signed-webhook traffic.",
    kind: "inferred",
    probe: (ctx) => {
      const s = ctx?.mcpStatus ?? "unknown";
      return MCP_STATUS_MAP[s] ?? MCP_STATUS_MAP.unknown;
    },
  },
];

/** Run a list of checks in parallel. Safe — never throws. */
export const runExternalChecks = async ({
  checks = DEFAULT_CHECKS,
  mcpStatus = "unknown",
} = {}) => {
  const ctx = { mcpStatus };
  return Promise.all(
    checks.map(async (check) => {
      const start = now();
      try {
        const result = await check.probe(ctx);
        return {
          id: check.id,
          label: check.label,
          hint: check.hint ?? null,
          kind: check.kind ?? "unknown",
          level: result.level,
          message: result.message ?? null,
          responseMs: result.responseMs ?? now() - start,
          checkedAt: now(),
        };
      } catch (err) {
        return {
          id: check.id,
          label: check.label,
          hint: check.hint ?? null,
          kind: check.kind ?? "unknown",
          level: "bad",
          message: err.message,
          responseMs: now() - start,
          checkedAt: now(),
        };
      }
    })
  );
};
