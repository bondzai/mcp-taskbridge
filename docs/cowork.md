# Using mcp-taskbridge with Claude Cowork

## TL;DR

Claude Cowork's connector UI (including the **Cowork tab inside Claude Desktop**) only accepts **remote HTTPS MCP servers** that speak the **streamable HTTP** dialect. Our local `bin/mcp.js` is stdio, so it cannot be added directly. Two paths:

1. **Recommended for quick testing** — use the Chat tab in Claude Desktop (local stdio is supported natively there via `claude_desktop_config.json`). See `docs/e2e-test.md` Path B.
2. **If you need the Cowork tab / Claude Cowork** — bridge stdio → streamable HTTP with supergateway, expose via a Cloudflare tunnel, then add the public URL in the Cowork connector UI.

Path 2 has been verified end-to-end: browser → web server → SQLite → MCP stdio → supergateway → cloudflared → Anthropic cloud → Cowork tab, with HMAC-signed webhooks streaming results back to the browser over SSE.

## Architecture (Cowork path)

```
 Browser                         Your machine                                  Cloudflare              Anthropic cloud
┌────────┐   HTTP POST /api/  ┌──────────────┐     in-process       ┌──────────────┐                 ┌────────────────┐
│  UI    │ ─────────────────▶ │  web server  │ ◀─── event bus ────▶ │ SSE /api/    │                 │  Claude model  │
│ (SSE)  │ ◀── SSE stream ─── │  :3000       │                      │  events      │                 │  (Cowork tab)  │
└────────┘                    └──────┬───────┘                      └──────────────┘                 └────────┬───────┘
                                     │ SQLite (data/tasks.db)                                                 │
                                     │                                                                        │
                                     │ HMAC-signed webhook                                                    │
                                     │ POST /webhooks/task-events                                             │
                                     │                                                                        │
                              ┌──────┴───────┐   stdio   ┌──────────────┐   HTTPS/quic   ┌──────────────┐     │
                              │  bin/mcp.js  │ ◀───────▶ │ supergateway │ ◀───────────── │  cloudflared │ ◀───┘
                              │  (MCP srv)   │           │  :8000 /mcp  │                │    tunnel    │  streamable HTTP /mcp
                              └──────────────┘           └──────────────┘                └──────────────┘
```

Two loops:
- **Forward loop** (Cowork → tools): model → tunnel → supergateway → stdio → `bin/mcp.js` → SQLite.
- **Return loop** (tools → UI): `bin/mcp.js` POSTs HMAC-signed webhook to the local web server → event bus → SSE → browser card flips state.

The forward loop leaves your machine via the tunnel; the return loop is purely local (`bin/mcp.js` talks to the web server over loopback).

## Verified setup (4 terminals)

The order matters: web server first (so webhooks have somewhere to land), then supergateway, then the tunnel, then add the connector in the UI.

### 0. One-time: rebuild native deps for your Node version

If you switched Node versions after `npm install`, `better-sqlite3` will crash with `NODE_MODULE_VERSION` mismatch. Rebuild once:

```bash
npm rebuild better-sqlite3
node --test --test-concurrency=1 tests/*.test.js    # expect 72 / 72 green
```

(Note: `npm test` in `package.json` passes `tests/` as a single arg, which Node 24+ treats as a module path and errors. Use the explicit glob above until the script is updated.)

### 1. Terminal A — web server

```bash
TASKBRIDGE_WEBHOOK_SECRET=dev-secret-change-me make web
```

Listens on `http://127.0.0.1:3000`. Leave it running. Submit one or two tasks from the browser so the MCP side has work to pick up.

### 2. Terminal B — supergateway (stdio → streamable HTTP)

Fast path — one target does it all:

```bash
make supergateway
```

That expands to the full command below (exported env vars come from the Makefile so the two processes share one secret):

```bash
TASKBRIDGE_AGENT_ID=claude-cowork \
TASKBRIDGE_WEBHOOK_SECRET=dev-secret-change-me \
TASKBRIDGE_WEBHOOK_URL=http://127.0.0.1:3000/webhooks/task-events \
npx -y supergateway \
  --stdio "node $(pwd)/bin/mcp.js" \
  --outputTransport streamableHttp \
  --protocolVersion 2025-03-26 \
  --cors \
  --port 8000
```

**The three non-default flags are load-bearing:**
- `--outputTransport streamableHttp` — Cowork speaks streamable HTTP, not the legacy SSE dialect that supergateway defaults to.
- `--protocolVersion 2025-03-26` — matches the MCP version Claude's connector client uses for the initial handshake. Without this, initialize races and tools/list can come back empty.
- `--cors` — Anthropic's connector client sends a preflight; without CORS you'll see no logs and a silent failure.

Startup log should end with:

```
[supergateway] StreamableHttp endpoint: http://localhost:8000/mcp
```

### 3. Terminal C — Cloudflare tunnel

```bash
brew install cloudflared    # one-time
make tunnel                 # cloudflared tunnel --url http://127.0.0.1:8000
```

Cloudflared prints a `https://<random>.trycloudflare.com` URL. **Append `/mcp`** to that URL — this full path is what Cowork needs.

Smoke-test the public URL from a fourth shell before touching the Cowork UI:

```bash
curl -sS -X POST https://<random>.trycloudflare.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

You should see a single SSE frame whose JSON body contains `"serverInfo":{"name":"mcp-taskbridge","version":"0.2.0"}`. If you get that, the full chain (tunnel → supergateway → stdio MCP → stdio response → supergateway → tunnel → you) is working.

For a longer-lived setup use a **named** Cloudflare tunnel with a DNS record, `ngrok`, a reverse proxy on your own VPS, or Tailscale Funnel. The trycloudflare URL is ephemeral and rotates each run.

### 4. Cowork UI click-path

1. Click your avatar → **Settings**
2. Go to **Customize → Connectors**
3. Click the **+** button → **Add custom connector**
4. Fill the dialog:
   - **Name**: `taskbridge`
   - **Remote MCP server URL**: `https://<random>.trycloudflare.com/mcp` ← include the `/mcp` suffix
   - **Advanced settings**: leave OAuth fields blank for dev
5. Click **Add**
6. In a conversation, click the **+** on the composer → **Connectors** → toggle **taskbridge** on per-conversation

## Confirming the connector actually handshook

Toggling the connector on is **silent**. Nothing visible happens until the model decides to call a tool, so "nothing happened" after toggle is normal — it doesn't mean the connector is broken.

To verify, tail supergateway's output (Terminal B). When you add the connector and toggle it on, you should see entries like:

```
[supergateway] StreamableHttp → Child: {"jsonrpc":"2.0","id":0,"method":"initialize", ... "clientInfo":{"name":"Anthropic", ...}}
[supergateway] Child → StreamableHttp: {"result":{"protocolVersion": ... "serverInfo":{"name":"mcp-taskbridge"...}}}
[supergateway] StreamableHttp → Child: {"jsonrpc":"2.0","id":1,"method":"tools/list"}
[supergateway] Child → StreamableHttp: {"result":{"tools":[{"name":"list_pending_tasks", ...
```

Seeing `clientInfo.name: "Anthropic"` in an initialize call proves Cowork itself reached your machine through the tunnel. Seeing all 6 tools come back on `tools/list` proves discovery worked.

## Security — read before exposing

A public tunnel makes `bin/mcp.js` reachable by anyone who guesses the URL. Before leaving it up:

- **Set a strong `TASKBRIDGE_WEBHOOK_SECRET`** — the default `dev-secret-change-me` is for localhost only. Every webhook the MCP process POSTs back is HMAC-signed with this secret, and the web server rejects bad signatures.
- **Restrict who can hit the tunnel** — Cloudflare Access (free tier) can require a Google / GitHub login on the trycloudflare URL. Alternatively, put basic auth in front of supergateway via nginx/caddy.
- **Only tunnel for the length of a test run** — bring the tunnel down (`Ctrl+C` cloudflared) the moment you're done. There is no replay cache; anyone who kept the URL can reconnect if it's still live.
- **Never tunnel a production DB path** — point `TASKBRIDGE_DB_PATH` at a throwaway file while you test, so a mistake can't corrupt real state.

## Driving the end-to-end flow

An MCP connector is passive — toggling it on only registers the tools with the model; no tool will be called until you prompt the model to use them. In the Cowork composer, send something explicit like:

> Use the **taskbridge** connector: call `list_pending_tasks`, then `claim_task` on the oldest one, answer the prompt, and call `submit_result` with your answer.

Expected timeline, watching `http://127.0.0.1:3000` in the browser:

1. Card for the oldest pending task flips `pending → in_progress`, tagged `claude-cowork` (this fires the moment Cowork's tool call reaches `claim_task` → `bin/mcp.js` POSTs a signed `task.claimed` webhook → web server broadcasts SSE).
2. (Optional) A progress line appears if the model calls `report_progress`.
3. Card flips `in_progress → done`, result text rendered in the card (fires on `submit_result` → signed `task.completed` webhook → SSE).

All four traversals of the diagram above happen for each task:
- Cowork → tunnel → supergateway → stdio → `bin/mcp.js` (the tool call)
- `bin/mcp.js` → web server (the HMAC webhook, loopback only)
- web server → browser (SSE)
- `bin/mcp.js` → stdio → supergateway → tunnel → Cowork (the tool response)

Then follow `docs/e2e-test.md` Path B from step B5 (DB state check) and B6 (`fail_task` path) — those steps are identical regardless of which MCP client drove the flow.

## If it fails to connect

| Symptom                                                    | Likely cause                                                                                                                                                                                       |
|------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| "Failed to fetch" when adding URL                          | Tunnel down, wrong path (must be `/mcp`, not bare domain), or supergateway started in the default SSE mode — re-launch with `--outputTransport streamableHttp`                                     |
| Cowork shows "0 tools" but connector saves                 | Supergateway is in SSE mode or `--protocolVersion` mismatch. Use `--outputTransport streamableHttp --protocolVersion 2025-03-26`                                                                   |
| Toggle the connector on, **absolutely nothing happens**    | Normal — the connector is passive. You must prompt the model to use it. Check supergateway logs for an `initialize` from `clientInfo.name: "Anthropic"` to confirm the handshake did happen        |
| Tool calls visible in logs but browser card never flips    | `bin/mcp.js` can't reach the web server for webhooks. Set `TASKBRIDGE_WEBHOOK_URL` to a URL the MCP process can reach (usually `http://127.0.0.1:<port>/webhooks/task-events` on the same machine) |
| 401 on every webhook                                       | `TASKBRIDGE_WEBHOOK_SECRET` mismatch between the MCP process (env in Terminal B) and the web server (env in Terminal A)                                                                            |
| `CONFLICT` when claiming                                   | Task already claimed by another agent. Pick a different pending task                                                                                                                               |
| `better-sqlite3` crashes with `NODE_MODULE_VERSION` error  | You switched Node versions after `npm install`. Run `npm rebuild better-sqlite3`                                                                                                                   |

## Alternative: skip Cowork for testing

For pure end-to-end validation of the bridge, **Claude Desktop is faster to set up** because it accepts the stdio MCP directly:

```json
{
  "mcpServers": {
    "taskbridge": {
      "command": "node",
      "args": ["/Users/jamesbond/Desktop/mcp-taskbridge/bin/mcp.js"],
      "env": {
        "TASKBRIDGE_AGENT_ID": "claude-desktop",
        "TASKBRIDGE_WEBHOOK_SECRET": "dev-secret-change-me"
      }
    }
  }
}
```

Reload Claude Desktop, then follow `docs/e2e-test.md` Path B.
