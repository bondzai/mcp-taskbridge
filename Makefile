# ============================================================
# MCP Taskbridge — automation
# Run `make` or `make help` to see available targets.
# ============================================================

SHELL            := /usr/bin/env bash
.SHELLFLAGS      := -e -o pipefail -c
MAKEFLAGS        += --no-print-directory

# ---- Config (override with `make VAR=value target`) -----------------------
NODE             ?= node
NPM              ?= npm
PORT_WEB         ?= 3000
PORT_MCP_HTTP    ?= 8000
WEB_HOST         ?= 127.0.0.1

# TASKBRIDGE_* variables use `?=` which respects an existing shell env
# var (make imports env into its variable namespace on reference). That
# means `TASKBRIDGE_AGENT_ID=codex make web` actually works — a previous
# version of this Makefile used an intermediate `AGENT_ID` variable and
# force-exported its value, which silently clobbered the shell's choice.
TASKBRIDGE_AGENT_ID       ?= generic
TASKBRIDGE_WEBHOOK_SECRET ?= dev-secret-change-me

MCP_BIN          := $(abspath bin/mcp.js)
TESTS            := tests/*.test.js
WEBHOOK_URL      := http://$(WEB_HOST):$(PORT_WEB)/webhooks/task-events

# MCP client integrations (auto-detected when present)
CODEX_BIN        ?= $(shell command -v codex 2>/dev/null || echo /Applications/Codex.app/Contents/Resources/codex)
ANTIGRAVITY_CFG  ?= $(HOME)/Library/Application Support/Antigravity/User/mcp.json
NODE_BIN         := $(shell command -v $(NODE))

# Re-export so every recipe (and sub-shells) sees the resolved values.
export TASKBRIDGE_AGENT_ID
export TASKBRIDGE_WEBHOOK_SECRET
export TASKBRIDGE_WEBHOOK_URL    := $(WEBHOOK_URL)
export TASKBRIDGE_WEB_HOST       := $(WEB_HOST)
export TASKBRIDGE_WEB_PORT       := $(PORT_WEB)

# Back-compat aliases for existing targets that still reference them.
AGENT_ID := $(TASKBRIDGE_AGENT_ID)
SECRET   := $(TASKBRIDGE_WEBHOOK_SECRET)

.DEFAULT_GOAL := help

# ============================================================
# Help
# ============================================================

.PHONY: help
help: ## Show this help
	@awk 'BEGIN { \
	    FS = ":.*?## "; \
	    printf "\n\033[1mMCP Taskbridge\033[0m — make targets\n\n"; \
	    printf "Usage:\n  make \033[36m<target>\033[0m [VAR=value]\n\n"; \
	    printf "Targets:\n"; \
	  } \
	  /^[a-zA-Z0-9_-]+:.*?## / { \
	    printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 \
	  }' $(MAKEFILE_LIST)
	@printf "\nConfig (override on CLI):\n"
	@printf "  PORT_WEB=%s  PORT_MCP_HTTP=%s  WEB_HOST=%s\n" "$(PORT_WEB)" "$(PORT_MCP_HTTP)" "$(WEB_HOST)"
	@printf "  AGENT_ID=%s  SECRET=%s\n\n" "$(AGENT_ID)" "$(SECRET)"

# ============================================================
# Install & build
# ============================================================

.PHONY: install
install: ## Install node dependencies
	$(NPM) install

.PHONY: rebuild
rebuild: ## Rebuild native deps (run after switching Node version)
	$(NPM) rebuild better-sqlite3

# ============================================================
# Test
# ============================================================

.PHONY: test
test: ## Run the full node:test suite (72 tests)
	$(NODE) --test --test-concurrency=1 $(TESTS)

.PHONY: test-watch
test-watch: ## Re-run tests on file change (requires: brew install entr)
	@command -v entr >/dev/null || { echo "install entr: brew install entr"; exit 1; }
	find src tests -name '*.js' | entr -c $(MAKE) test

# ============================================================
# Run services
# ============================================================

.PHONY: web
web: ## Start the web server in foreground on $(PORT_WEB)
	$(NPM) run start:web

.PHONY: dev
dev: ## Start the web server with .env.local loaded (use this for local smoke tests)
	@test -f .env.local || { echo "✗ .env.local not found. Create it with OPENAI_API_KEY=... PROCUREMENT_ENABLED=true"; exit 1; }
	@echo "Loading .env.local → starting web on :$(PORT_WEB)"
	@set -a; . ./.env.local; set +a; $(NPM) run start:web

.PHONY: mcp
mcp: ## Start the stdio MCP server (normally launched by Claude, not manually)
	$(NPM) run start:mcp

.PHONY: supergateway
supergateway: ## Wrap bin/mcp.js as streamable HTTP on $(PORT_MCP_HTTP) for Cowork
	npx -y supergateway \
	  --stdio "$(NODE) $(MCP_BIN)" \
	  --outputTransport streamableHttp \
	  --protocolVersion 2025-03-26 \
	  --cors \
	  --port $(PORT_MCP_HTTP)

.PHONY: tunnel
tunnel: check-cloudflared ## Open a Cloudflare quick tunnel to the supergateway port
	cloudflared tunnel --url http://127.0.0.1:$(PORT_MCP_HTTP)

.PHONY: cowork
cowork: ## Print the 3-terminal Cowork setup recipe
	@printf '%s\n' \
	  "Claude Cowork setup — open three terminals in this repo:" \
	  "" \
	  "  1) make web           # port $(PORT_WEB)" \
	  "  2) make supergateway  # port $(PORT_MCP_HTTP)" \
	  "  3) make tunnel        # prints https://<random>.trycloudflare.com" \
	  "" \
	  "Then paste   <tunnel>/mcp   into Cowork → Settings → Connectors → Add custom connector." \
	  "Full walkthrough: docs/cowork.md"

# ============================================================
# Smoke tests (need a running server)
# ============================================================

.PHONY: smoke
smoke: ## Probe the web server (requires: make web running)
	@curl -sSf -o /dev/null http://127.0.0.1:$(PORT_WEB)/api/tasks
	@curl -sSf -o /dev/null http://127.0.0.1:$(PORT_WEB)/api/config
	@curl -sSf -o /dev/null http://127.0.0.1:$(PORT_WEB)/api/changelog
	@curl -sSf -o /dev/null http://127.0.0.1:$(PORT_WEB)/api/health
	@echo "✓ web responding on :$(PORT_WEB) (tasks, config, changelog, health)"

.PHONY: smoke-procurement
smoke-procurement: ## Probe procurement endpoints (export, list, etc.)
	@curl -sSf -o /dev/null http://127.0.0.1:$(PORT_WEB)/api/procurement/prs
	@curl -sSf -o /dev/null http://127.0.0.1:$(PORT_WEB)/api/procurement/prs/export
	@echo "✓ procurement endpoints responding"

.PHONY: smoke-mcp
smoke-mcp: ## Probe the supergateway /mcp endpoint (requires: make supergateway running)
	@curl -sSf -X POST http://127.0.0.1:$(PORT_MCP_HTTP)/mcp \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"make-smoke","version":"0"}}}' \
	  | head -c 400
	@echo
	@echo "✓ mcp responding on :$(PORT_MCP_HTTP)"

# ============================================================
# MCP client integrations
# ============================================================

.PHONY: mcp-register-codex
mcp-register-codex: ## Register taskbridge with OpenAI Codex (edits ~/.codex/config.toml)
	@test -x "$(CODEX_BIN)" || { echo "✗ codex binary not found at $(CODEX_BIN)"; exit 1; }
	"$(CODEX_BIN)" mcp add taskbridge \
	  --env TASKBRIDGE_AGENT_ID=codex \
	  --env TASKBRIDGE_WEBHOOK_SECRET=$(SECRET) \
	  --env TASKBRIDGE_WEBHOOK_URL=$(WEBHOOK_URL) \
	  -- $(NODE_BIN) $(MCP_BIN)
	@echo "✓ taskbridge registered. Verify with: make mcp-list-codex"

.PHONY: mcp-list-codex
mcp-list-codex: ## List MCP servers registered with Codex
	@test -x "$(CODEX_BIN)" || { echo "✗ codex binary not found at $(CODEX_BIN)"; exit 1; }
	"$(CODEX_BIN)" mcp list

.PHONY: mcp-unregister-codex
mcp-unregister-codex: ## Remove taskbridge from Codex
	@test -x "$(CODEX_BIN)" || { echo "✗ codex binary not found at $(CODEX_BIN)"; exit 1; }
	"$(CODEX_BIN)" mcp remove taskbridge
	@echo "✓ taskbridge removed from Codex"

.PHONY: mcp-register-antigravity
mcp-register-antigravity: ## Print the mcp.json snippet to paste into Antigravity
	@printf '\n%s\n' "Antigravity uses VS Code-style MCP config. Paste the JSON below into:"
	@printf '  %s\n\n' "$(ANTIGRAVITY_CFG)"
	@printf '%s\n' "If the file already exists, merge the \"servers.taskbridge\" entry into it."
	@printf '%s\n\n' "After saving, fully quit and relaunch Antigravity (⌘Q, not just close the window)."
	@printf '%s\n' '{'
	@printf '%s\n' '  "servers": {'
	@printf '%s\n' '    "taskbridge": {'
	@printf '%s\n' '      "type": "stdio",'
	@printf '      "command": "%s",\n' "$(NODE_BIN)"
	@printf '      "args": ["%s"],\n' "$(MCP_BIN)"
	@printf '%s\n' '      "env": {'
	@printf '        "TASKBRIDGE_AGENT_ID": "antigravity",\n'
	@printf '        "TASKBRIDGE_WEBHOOK_SECRET": "%s",\n' "$(SECRET)"
	@printf '        "TASKBRIDGE_WEBHOOK_URL": "%s"\n' "$(WEBHOOK_URL)"
	@printf '%s\n' '      }'
	@printf '%s\n' '    }'
	@printf '%s\n' '  }'
	@printf '%s\n' '}'
	@printf '\nOr: open the Antigravity command palette → "MCP: Add Server…" → "Command (stdio)" and point it at %s\n\n' "$(MCP_BIN)"

# ============================================================
# Maintenance
# ============================================================

.PHONY: clean
clean: ## Remove the SQLite dev database
	rm -f data/tasks.db data/tasks.db-shm data/tasks.db-wal
	@echo "✓ cleaned data/tasks.db*"

.PHONY: fresh
fresh: clean install rebuild test ## Full wipe → install → rebuild → test

# ============================================================
# Diagnostics
# ============================================================

.PHONY: check-deps
check-deps: check-node check-npm check-cloudflared ## Verify host tools are installed

.PHONY: check-node
check-node:
	@command -v $(NODE) >/dev/null || { echo "✗ node missing — install Node 18+"; exit 1; }
	@printf "✓ node   %s\n" "$$($(NODE) -v)"

.PHONY: check-npm
check-npm:
	@command -v $(NPM) >/dev/null || { echo "✗ npm missing"; exit 1; }
	@printf "✓ npm    %s\n" "$$($(NPM) -v)"

.PHONY: check-cloudflared
check-cloudflared:
	@command -v cloudflared >/dev/null || { echo "✗ cloudflared missing — brew install cloudflared"; exit 1; }
	@printf "✓ cloudflared %s\n" "$$(cloudflared --version 2>&1 | head -n1)"

.PHONY: version
version: ## Print the package version
	@$(NODE) -p "require('./package.json').version"

.PHONY: changelog
changelog: ## Show the changelog
	@command -v less >/dev/null && less CHANGELOG.md || cat CHANGELOG.md
