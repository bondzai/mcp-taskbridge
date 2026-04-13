import test from "node:test";
import assert from "node:assert/strict";
import {
  adapterForClientName,
  createClientTracker,
} from "../src/core/client-detection.js";

test("adapterForClientName: known Codex client variants", () => {
  assert.equal(adapterForClientName("codex-mcp-client"), "codex");
  assert.equal(adapterForClientName("Codex-MCP-Client"), "codex");
  assert.equal(adapterForClientName("codex"), "codex");
  // Pattern-matching catches any future variant containing "codex"
  assert.equal(adapterForClientName("Codex Desktop"), "codex");
  assert.equal(adapterForClientName("openai-codex"), "codex");
  assert.equal(adapterForClientName("openai-codex-cli-v2"), "codex");
  assert.equal(adapterForClientName("Codex.Desktop"), "codex");
});

test("adapterForClientName: Anthropic clients map to claude-cowork", () => {
  assert.equal(adapterForClientName("Anthropic"), "claude-cowork");
  assert.equal(adapterForClientName("anthropic"), "claude-cowork");
});

test("adapterForClientName: Claude Desktop / Code / Cowork direct names", () => {
  assert.equal(adapterForClientName("claude-desktop"), "claude-desktop");
  assert.equal(adapterForClientName("claude-code"), "claude-code");
  assert.equal(adapterForClientName("claude-cowork"), "claude-cowork");
});

test("adapterForClientName: Antigravity (and namespaced variants)", () => {
  assert.equal(adapterForClientName("antigravity"), "antigravity");
  assert.equal(adapterForClientName("google-antigravity"), "antigravity");
  assert.equal(adapterForClientName("Antigravity IDE"), "antigravity");
  assert.equal(adapterForClientName("AntigravityIDE-2.0"), "antigravity");
});

test("adapterForClientName: bare 'openai' falls back to codex", () => {
  // Not actually a real Codex name but a reasonable bet for OpenAI-tooling
  // clients we don't otherwise know about.
  assert.equal(adapterForClientName("openai-mcp-client"), "codex");
});

test("adapterForClientName: pattern priority — 'claude-desktop' wins over 'anthropic'", () => {
  assert.equal(adapterForClientName("Claude Desktop (Anthropic)"), "claude-desktop");
});

test("adapterForClientName: unknown name falls back to 'generic' by default", () => {
  assert.equal(adapterForClientName("some-future-ai-agent"), "generic");
});

test("adapterForClientName: unknown name with custom fallback", () => {
  assert.equal(adapterForClientName("some-future-ai-agent", "demo"), "demo");
});

test("adapterForClientName: empty / null / whitespace → fallback", () => {
  assert.equal(adapterForClientName("", "fb"), "fb");
  assert.equal(adapterForClientName(null, "fb"), "fb");
  assert.equal(adapterForClientName("   ", "fb"), "fb");
});

const fakeReq = (ua, ip = "127.0.0.1") => ({
  headers: { "user-agent": ua },
  ip,
});

const initMsg = (clientName) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: clientName } },
});

test("createClientTracker: observe() on initialize caches resolved adapter", () => {
  const tracker = createClientTracker({ fallback: "generic" });
  const req = fakeReq("codex/1.2.3");
  assert.equal(tracker.resolve(req), "generic"); // nothing cached yet
  tracker.observe(req, initMsg("codex-mcp-client"));
  assert.equal(tracker.resolve(req), "codex");
});

test("createClientTracker: different User-Agents are tracked independently", () => {
  const tracker = createClientTracker({ fallback: "generic" });
  const codex = fakeReq("codex/1.0");
  const anth = fakeReq("anthropic/1.0");
  tracker.observe(codex, initMsg("codex-mcp-client"));
  tracker.observe(anth, initMsg("Anthropic"));
  assert.equal(tracker.resolve(codex), "codex");
  assert.equal(tracker.resolve(anth), "claude-cowork");
});

test("createClientTracker: non-initialize messages do not mutate the cache", () => {
  const tracker = createClientTracker({ fallback: "generic" });
  const req = fakeReq("codex/1.0");
  tracker.observe(req, initMsg("codex-mcp-client"));
  tracker.observe(req, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "claim_task", arguments: { task_id: "x" } },
  });
  assert.equal(tracker.resolve(req), "codex");
});

test("createClientTracker: batched JSON-RPC — picks up initialize inside an array", () => {
  const tracker = createClientTracker({ fallback: "generic" });
  const req = fakeReq("codex/1.0");
  tracker.observe(req, [initMsg("codex-mcp-client"), { jsonrpc: "2.0", id: 2, method: "ping" }]);
  assert.equal(tracker.resolve(req), "codex");
});

test("createClientTracker: unknown client still caches fallback", () => {
  const tracker = createClientTracker({ fallback: "generic" });
  const req = fakeReq("something/1.0");
  tracker.observe(req, initMsg("some-future-ai-agent"));
  assert.equal(tracker.resolve(req), "generic");
});

test("createClientTracker: cache is bounded at 256 entries (LRU-ish)", () => {
  const tracker = createClientTracker({ fallback: "generic" });
  for (let i = 0; i < 260; i++) {
    tracker.observe(fakeReq(`ua-${i}`), initMsg("codex-mcp-client"));
  }
  assert.equal(tracker._cache.size, 256);
});

test("createClientTracker: resolve falls back to last-init-seen if no cache hit", () => {
  const tracker = createClientTracker({ fallback: "generic" });
  // Init on one connection key.
  tracker.observe(fakeReq("codex/1.0"), initMsg("codex-mcp-client"));
  // Subsequent request uses a DIFFERENT User-Agent → cache miss on the
  // per-key map, but the server-wide last-init-seen says "codex".
  assert.equal(tracker.resolve(fakeReq("totally-different/2.0")), "codex");
});

test("createClientTracker: explicit static fallback used when no init at all", () => {
  const tracker = createClientTracker({ fallback: "demo" });
  assert.equal(tracker.resolve(fakeReq("anything/1.0")), "demo");
});

test("createClientTracker: lastInitAdapter / lastInitClientName accessors", () => {
  const tracker = createClientTracker({ fallback: "generic" });
  assert.equal(tracker.lastInitAdapter, null);
  tracker.observe(fakeReq("codex/1.0"), initMsg("codex-mcp-client"));
  assert.equal(tracker.lastInitAdapter, "codex");
  assert.equal(tracker.lastInitClientName, "codex-mcp-client");
});

test("createClientTracker: logger callback receives detected clients", () => {
  const captured = [];
  const tracker = createClientTracker({
    fallback: "generic",
    logger: { info: (msg, meta) => captured.push({ msg, meta }) },
  });
  tracker.observe(fakeReq("codex/1.0", "1.2.3.4"), initMsg("codex-mcp-client"));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].msg, "mcp client detected");
  assert.equal(captured[0].meta.clientName, "codex-mcp-client");
  assert.equal(captured[0].meta.adapterId, "codex");
  assert.equal(captured[0].meta.ua, "codex/1.0");
});
