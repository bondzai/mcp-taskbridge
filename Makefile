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
AGENT_ID         ?= claude-cowork
SECRET           ?= dev-secret-change-me

MCP_BIN          := $(abspath bin/mcp.js)
TESTS            := tests/*.test.js
WEBHOOK_URL      := http://$(WEB_HOST):$(PORT_WEB)/webhooks/task-events

# Exported so every recipe (and sub-shells) sees the same config.
export TASKBRIDGE_AGENT_ID       = $(AGENT_ID)
export TASKBRIDGE_WEBHOOK_SECRET = $(SECRET)
export TASKBRIDGE_WEBHOOK_URL    = $(WEBHOOK_URL)
export TASKBRIDGE_WEB_HOST       = $(WEB_HOST)
export TASKBRIDGE_WEB_PORT       = $(PORT_WEB)

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
	@echo "✓ web responding on :$(PORT_WEB) (tasks, config, changelog)"

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
