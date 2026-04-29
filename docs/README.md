# Documentation

Pick the doc that matches what you're doing. Each one is single-purpose and self-contained.

| Doc | Read when |
|---|---|
| [setup.md](setup.md) | You're starting from a fresh clone — install, test, run, register with an MCP client. |
| [architecture.md](architecture.md) | You want to understand or modify internals — process topology, module layout, event bus, data model. |
| [mcp-tools.md](mcp-tools.md) | You're debugging an agent's tool call or writing prompts — full input/output/error contracts for all 6 MCP tools. |
| [api.md](api.md) | You're integrating a non-MCP HTTP caller — REST + SSE + webhook contracts, HMAC signature scheme. |
| [e2e-test.md](e2e-test.md) | You're verifying a fresh install end-to-end — Path A (HTTP only) + Path B (real MCP client). |
| [cowork.md](cowork.md) | You're wiring taskbridge into Claude Cowork (or any cloud MCP client that only accepts remote HTTPS). |
| [cloudflare-tunnel.md](cloudflare-tunnel.md) | You want a **permanent** public HTTPS URL for taskbridge via a Cloudflare named tunnel. Canonical production setup. |
| [cloud-run.md](cloud-run.md) | You're deploying to Google Cloud Run with Supabase PostgreSQL — env file, deploy script, monitoring, rollback. |

See also:

- [`../README.md`](../README.md) — project overview and quick-start
- [`../CHANGELOG.md`](../CHANGELOG.md) — release history (Keep-a-Changelog format)
- [`../Makefile`](../Makefile) — run `make help` for every automation target

## 30-second cheat sheet

```bash
make install    # npm install
make rebuild    # npm rebuild better-sqlite3 (after switching Node version)
make test       # node --test tests/*.test.js — expect 72 / 72
make web        # start the web server on :3000
make smoke      # quick probe of a running web server
make cowork     # print the 3-terminal Cowork recipe
make help       # list every target
```

## Conventions used in these docs

- Code blocks are copy-paste runnable on macOS / Linux / WSL with the working directory at the repo root.
- `TASKBRIDGE_*` environment variables are the only runtime knobs; see `setup.md` for the full table.
- HTTP endpoints are relative to `http://127.0.0.1:3000` unless otherwise noted.
- MCP tool names are in `snake_case`; HTTP route parameters are in `camelCase`.
