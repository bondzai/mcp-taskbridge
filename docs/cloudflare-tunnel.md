# Permanent Cloudflare Tunnel setup

This is the canonical way to give taskbridge a **stable public HTTPS URL** so
remote MCP clients (Claude Cowork, a friend's agent, anything in the cloud) can
reach your local web server without you having to re-register the URL every
time `cloudflared` restarts.

If you just want a throw-away URL for a single test session, skip this doc and
run `make tunnel` — that fires a quick tunnel whose `*.trycloudflare.com`
hostname rotates on every restart. Good enough for an hour of experimentation,
not good enough for daily use.

---

## TL;DR

1. Own a domain whose nameservers point to Cloudflare.
2. `cloudflared tunnel login` (one browser click).
3. `cloudflared tunnel create taskbridge`
4. `cloudflared tunnel route dns taskbridge taskbridge.yourdomain.com`
5. Drop a `~/.cloudflared/config.yml` pointing that hostname at
   `http://localhost:3000`.
6. `cloudflared tunnel run taskbridge` (or `sudo cloudflared service install`
   to auto-start on boot).
7. Register `https://taskbridge.yourdomain.com/mcp/<adapter>` as the MCP URL
   in your client (e.g. `/mcp/claude-cowork`).

Everything after step 1 is pure CLI. Step 1 is the only part that can take
hours — because changing nameservers at your domain registrar has a
propagation delay.

---

## Architecture

```
       Claude Cowork / any cloud MCP client
                     │
                     ▼  HTTPS (443)
       ┌───────────────────────────┐
       │   Cloudflare edge         │
       │   <sub>.yourdomain.com    │
       └───────────────┬───────────┘
                       │  outbound tunnel
                       │  (cloudflared connects
                       │   OUT from your Mac)
                       ▼
       ┌───────────────────────────┐
       │   cloudflared (your Mac)  │
       └───────────────┬───────────┘
                       │  plain HTTP to loopback
                       ▼
       ┌───────────────────────────┐
       │   bin/web.js on :3000     │
       │   native /mcp/<adapter>   │
       │   → service → SQLite → SSE│
       └───────────────────────────┘
```

Your Mac never opens an inbound port. cloudflared dials OUT to the Cloudflare
edge and keeps a persistent connection; requests to your hostname are
multiplexed back over that connection. This is the whole reason it works
through home routers, corporate NAT, and mobile hotspots without any port
forwarding.

---

## Prerequisites

| You need | Have it? |
|---|---|
| A Cloudflare account (free tier is fine) | Sign up at https://dash.cloudflare.com/sign-up |
| A domain whose **nameservers point to Cloudflare** | Either transfer DNS management of an existing domain (takes ~30 min), or buy a new one via Cloudflare Registrar (~$9/yr .com, at-cost) |
| `cloudflared` CLI | `brew install cloudflared` on macOS, or the [official downloads page](https://github.com/cloudflare/cloudflared/releases) elsewhere |
| The taskbridge web server running on `http://localhost:3000` | `make web` |

The domain requirement is non-negotiable. Cloudflared's "named tunnels" route
through Cloudflare's DNS, and that DNS zone has to be managed by Cloudflare.
Domains registered elsewhere are fine — you just have to update the
nameservers.

---

## Step 1 — Create a Cloudflare account

Skip if you already have one.

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up with any email, verify it.
3. Free tier is all we need — no payment method required at this step.

## Step 2 — Add your domain to Cloudflare

1. Cloudflare dashboard → **Add a site** → enter your domain (e.g.
   `yourdomain.com`) → **Continue**.
2. Pick the **Free** plan → **Continue**.
3. Cloudflare auto-scans your current DNS records at whichever registrar /
   DNS host the domain lives on. Review them — they should match what's
   live today. Click **Continue**.
4. Cloudflare gives you **two nameservers** of the form
   `<NAME1>.ns.cloudflare.com` / `<NAME2>.ns.cloudflare.com`.
   **Copy both** — you'll paste them into your registrar's control panel in
   the next step.

## Step 3 — Update nameservers at your registrar

This is the only step that takes real time. Nameserver changes propagate
anywhere from ~5 minutes to 48 hours; the typical case is 10–30 minutes.

### Namecheap (example)

1. Log in at https://namecheap.com → **Domain List** → click **Manage** next
   to your domain.
2. In the **NAMESERVERS** section, change the dropdown from **Namecheap
   BasicDNS** to **Custom DNS**.
3. Paste the two nameservers Cloudflare gave you.
4. Click the green checkmark to save.

### Other registrars (GoDaddy / Google Domains / Gandi / Porkbun / …)

The path is the same idea: find "Nameservers" or "NS records" in the domain
settings, switch to "custom nameservers", paste the two Cloudflare values,
save.

### Back in Cloudflare

- Click **Done, check nameservers**.
- Cloudflare will email you when it detects the change. You can also refresh
  the dashboard — the domain's status will flip from "Pending nameserver
  update" to "Active".

### While you wait

Your existing DNS records keep resolving during the transition because
Cloudflare imported them in step 2. Mail, web, anything else continues to
work. There's no downtime.

## Step 4 — Authenticate cloudflared with your account

Once the domain shows **Active** in the Cloudflare dashboard, run:

```bash
cloudflared tunnel login
```

This opens a browser window. Log in to Cloudflare, **select your domain**, and
click **Authorize**. Cloudflared saves a certificate to `~/.cloudflared/cert.pem`.
You only have to do this once per machine per Cloudflare account.

## Step 5 — Create the named tunnel

```bash
cloudflared tunnel create taskbridge
```

Expected output:

```
Tunnel credentials written to /Users/<you>/.cloudflared/<UUID>.json
Created tunnel taskbridge with id <UUID>
```

Copy the `<UUID>` — you'll reference it in the config file. The name
`taskbridge` is just a label; you can pick anything.

## Step 6 — Point a subdomain at the tunnel

```bash
cloudflared tunnel route dns taskbridge taskbridge.yourdomain.com
```

This creates a CNAME in Cloudflare DNS:
`taskbridge.yourdomain.com → <UUID>.cfargotunnel.com`, proxied through
Cloudflare. Replace `yourdomain.com` with your actual domain. The subdomain
(`taskbridge`) is arbitrary — `tb`, `mcp`, `bridge`, whatever.

## Step 7 — Write the tunnel config file

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: taskbridge
credentials-file: /Users/<you>/.cloudflared/<UUID>.json

ingress:
  # Route all requests to the hostname at the local web server.
  - hostname: taskbridge.yourdomain.com
    service: http://localhost:3000
  # Catch-all (required): anything that doesn't match returns 404.
  - service: http_status:404
```

Replace `<you>`, `<UUID>`, and `yourdomain.com` with your real values. Note
that `service` points at **port 3000** — the native taskbridge web server —
not 8000. Since v0.4.0 the web server bakes `/mcp` directly into Express, so
supergateway is no longer on the critical path.

## Step 8 — Run the tunnel

Foreground (for first test):

```bash
cloudflared tunnel run taskbridge
```

Expected output: lines saying `Registered tunnel connection` for each of the
four regional edge servers cloudflared connects to. Leave it running.

## Step 9 — Smoke test it from any shell

```bash
curl -sS -X POST https://taskbridge.yourdomain.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

Expected: an SSE frame whose JSON body contains
`"serverInfo":{"name":"mcp-taskbridge","version":"…"}`. If you see that, the
full chain (Cloudflare edge → tunnel → your Mac → `bin/web.js` → MCP
handler) works.

## Step 10 — Register with your MCP client

The URL to paste is `https://taskbridge.yourdomain.com/mcp/<adapter>`, where
`<adapter>` is the per-URL routing suffix from v0.6.0. Pick any name —
whatever you pass becomes the agent badge in the browser UI.

| MCP client | URL to register |
|---|---|
| Claude Desktop / **Cowork** tab | `https://taskbridge.yourdomain.com/mcp/claude-cowork` |
| Claude Desktop → **Chat** tab via Custom connector | `https://taskbridge.yourdomain.com/mcp/claude-desktop` |
| **Codex** (Streamable HTTP) | `https://taskbridge.yourdomain.com/mcp/codex` |
| Google **Antigravity** (if remote HTTPS supported) | `https://taskbridge.yourdomain.com/mcp/antigravity` |
| A **custom agent** you're building | `https://taskbridge.yourdomain.com/mcp/<your-worker-name>` |

In Claude Desktop's Cowork tab:

1. Avatar → **Settings → Connectors → Add custom connector**
2. **Name**: `taskbridge`
3. **Remote MCP server URL**: the URL from the table above
4. **Advanced settings**: leave OAuth fields blank (we'll add auth in a
   moment)
5. **Add** → open a new Cowork chat → **+ → Connectors** → toggle
   **taskbridge** on.

---

## Optional — Run cloudflared as a macOS service (auto-start on login)

So the tunnel survives Mac restarts and logoffs without you having to run it
manually:

```bash
sudo cloudflared service install
```

This creates a launchd plist at
`/Library/LaunchDaemons/com.cloudflare.cloudflared.plist`. Check status:

```bash
sudo launchctl list | grep cloudflared
```

View logs:

```bash
tail -f /Library/Logs/com.cloudflare.cloudflared.out.log
```

Uninstall later:

```bash
sudo cloudflared service uninstall
```

---

## Optional — Lock the tunnel down with Cloudflare Access

**Without this step, anyone who guesses `https://taskbridge.yourdomain.com/mcp/*`
can claim and submit tasks against your local instance**. The taskbridge web
server doesn't have auth of its own — it assumes loopback. Once you put it
on the public internet, you need an auth layer in front.

Cloudflare Access (free tier) lets you gate the tunnel behind a Google /
GitHub / OTP login with zero code changes:

1. Cloudflare dashboard → **Zero Trust → Access → Applications → Add an
   application → Self-hosted**.
2. **Application domain**: `taskbridge.yourdomain.com`.
3. Optionally scope the protection to a path: `/mcp/*`.
4. Add a **policy**: "Require email address `your@email.com`" — or
   "Require email ending in `@yourcompany.com`".
5. Save.

After this, hitting the URL from a fresh browser will bounce you through a
Cloudflare login screen. Once authenticated, Access mints a cookie that your
browser sends on every subsequent request — normal use is transparent.

For headless MCP clients that can't handle the OAuth bounce (most of them
can't, as of 2026), use a **service token** instead:

1. Zero Trust → Access → **Service Auth → Service Tokens** → Create.
2. Copy the generated `CF-Access-Client-Id` and `CF-Access-Client-Secret`.
3. Add an Access policy for this app that allows "Service Auth" with the
   matching token.
4. Configure your MCP client to send both headers on every request. Claude
   Desktop's Cowork connector supports a generic headers-passthrough via
   the advanced / OAuth fields — mechanism varies by client version.

For dev use without a service token, a common shortcut is to scope the
Access application to your email alone, then use a **long-lived WARP
session** on the machine running the MCP client — but that's a workaround,
not the intended design.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `cloudflared tunnel login` hangs / never opens browser | Headless environment | Copy the URL it prints and open it manually |
| `cloudflared tunnel route dns` says "already exists" | Previous attempt left a stale CNAME | Delete the `taskbridge.<domain>` CNAME in the Cloudflare dashboard and re-run |
| `cloudflared tunnel run` exits with `error parsing config` | YAML typo — tab instead of spaces, or a missing `service:` in the catch-all | Validate with `cloudflared tunnel ingress validate` |
| Browser hits the hostname and gets Cloudflare's **error 1033** | The tunnel isn't running, or the machine running it can't reach `localhost:3000` | Check `lsof -ti :3000` for the web server; check `cloudflared tunnel info taskbridge` |
| Browser gets **error 502** ("Bad Gateway") | Tunnel is up but `config.yml` points at the wrong local port | Fix the `service:` line to `http://localhost:3000`; restart cloudflared |
| curl smoke returns HTML instead of JSON | You hit the Cloudflare challenge page (Bot Fight Mode) | Cloudflare dashboard → Security → Bots → turn Bot Fight Mode off for this zone, or allow-list `/mcp/*` in WAF |
| MCP client shows "0 tools" after connecting | Tunnel works but the MCP handshake is failing — probably because your client expects a different transport version | Check `make smoke-mcp` against the tunnel URL; paste the stderr log line from `mcp request` on the web server |

### Quick health checks

```bash
# Is cloudflared running?
pgrep -fl "cloudflared tunnel run" || echo "NOT RUNNING"

# Does the DNS record exist?
dig +short taskbridge.yourdomain.com

# Is the tunnel reachable from the edge?
curl -sS -o /dev/null -w "%{http_code}\n" https://taskbridge.yourdomain.com/

# Does /mcp handshake?
curl -sS -X POST https://taskbridge.yourdomain.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | head -c 400
```

---

## Alternative — quick tunnel for dev (no account, no domain)

For a one-shot hour-long test session, `make tunnel` in the repo runs a
cloudflared quick tunnel. URL rotates on every restart, don't use it for
anything you want to leave up longer than a working session.

```bash
make tunnel
# prints: https://<random>.trycloudflare.com
# append /mcp/<adapter> and paste into your MCP client
```

The rest of this doc is about the permanent path; the quick tunnel is
discussed in `cowork.md`.

---

## What to do if you stop using this tunnel

- **Delete the tunnel**: `cloudflared tunnel delete taskbridge`
- **Delete the CNAME**: Cloudflare dashboard → DNS → remove the
  `taskbridge` record.
- **Uninstall the service** if you installed it:
  `sudo cloudflared service uninstall`.
- **Remove the Access application** if you created one:
  dashboard → Zero Trust → Access → Applications → delete.
- **Delete `~/.cloudflared/`** if you want the machine clean of
  credentials.

The domain itself and the Cloudflare account stay — there's no rollback
cost to either.
