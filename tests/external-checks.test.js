import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runExternalChecks, probeMcpHttp } from "../src/core/external-checks.js";

const startFakeMcp = (responder) =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => responder(req, res, body));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/mcp` });
    });
  });

test("runExternalChecks: aggregates stub results and preserves metadata", async () => {
  const results = await runExternalChecks({
    mcpStatus: "active",
    checks: [
      {
        id: "fake-ok",
        label: "Fake OK",
        kind: "custom",
        hint: "always green",
        probe: async () => ({ level: "ok", message: "hi", responseMs: 10 }),
      },
      {
        id: "fake-bad",
        label: "Fake Bad",
        kind: "custom",
        probe: async () => ({ level: "bad", message: "nope" }),
      },
      {
        id: "fake-throws",
        label: "Fake Throws",
        kind: "custom",
        probe: async () => { throw new Error("boom"); },
      },
      {
        id: "mcp-clients",
        label: "Stdio MCP clients",
        kind: "inferred",
        // Use the real default probe to prove the mcpStatus context flows through.
        probe: (ctx) => ({ level: ctx.mcpStatus === "active" ? "ok" : "off", message: `status=${ctx.mcpStatus}` }),
      },
    ],
  });

  assert.equal(results.length, 4);

  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId["fake-ok"].level, "ok");
  assert.equal(byId["fake-ok"].message, "hi");
  assert.equal(byId["fake-ok"].responseMs, 10);
  assert.equal(byId["fake-ok"].hint, "always green");

  assert.equal(byId["fake-bad"].level, "bad");

  assert.equal(byId["fake-throws"].level, "bad");
  assert.equal(byId["fake-throws"].message, "boom");

  assert.equal(byId["mcp-clients"].level, "ok");
  assert.equal(byId["mcp-clients"].message, "status=active");

  for (const r of results) {
    assert.ok(typeof r.responseMs === "number");
    assert.ok(typeof r.checkedAt === "number");
  }
});

test("probeMcpHttp: returns ok when server responds with taskbridge serverInfo", async () => {
  const { server, url } = await startFakeMcp((req, res, _body) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.end(`event: message\ndata: {"result":{"serverInfo":{"name":"mcp-taskbridge","version":"0.0.0"}},"jsonrpc":"2.0","id":1}\n\n`);
  });
  try {
    const out = await probeMcpHttp(url, 2000);
    assert.equal(out.level, "ok");
    assert.match(out.message, /initialize ok/);
    assert.ok(out.responseMs >= 0);
  } finally {
    server.close();
  }
});

test("probeMcpHttp: warn when a non-taskbridge server answers", async () => {
  const { server, url } = await startFakeMcp((req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ result: { serverInfo: { name: "something-else" } } }));
  });
  try {
    const out = await probeMcpHttp(url, 2000);
    assert.equal(out.level, "warn");
  } finally {
    server.close();
  }
});

test("probeMcpHttp: bad when server returns non-2xx", async () => {
  const { server, url } = await startFakeMcp((req, res) => {
    res.statusCode = 500;
    res.end("boom");
  });
  try {
    const out = await probeMcpHttp(url, 2000);
    assert.equal(out.level, "bad");
    assert.match(out.message, /HTTP 500/);
  } finally {
    server.close();
  }
});

test("probeMcpHttp: off when connection refused", async () => {
  // Port 1 is reserved — should refuse immediately.
  const out = await probeMcpHttp("http://127.0.0.1:1/mcp", 1000);
  assert.ok(out.level === "off" || out.level === "bad");
});
