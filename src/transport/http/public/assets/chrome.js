/* ============================================================
   Shared chrome — navbar, theme switcher, time utils, toast,
   changelog modal, prompt library modal.
   Loaded as a module from every page.
   ============================================================ */

import { PROMPT_TEMPLATES, buildPrompt, copyToClipboard } from "./prompts.js";

const STORAGE_KEY = "taskbridge.settings.v1";

const DEFAULT_SETTINGS = {
  theme: "auto", // light | dark | dim | auto
  pageSize: 10,
  defaultStatus: "all",
  defaultSort: "newest",
};

export const loadSettings = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (patch) => {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
};

/* ---------- Theme ---------- */

const resolveTheme = (choice) => {
  if (choice === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dim" : "light";
  }
  return choice;
};

export const applyTheme = (choice) => {
  const effective = resolveTheme(choice);
  const html = document.documentElement;
  html.setAttribute("data-theme", effective);
  // Bootstrap only knows light/dark — map dim → dark for its components.
  html.setAttribute("data-bs-theme", effective === "light" ? "light" : "dark");
};

/* ---------- Time formatting ---------- */

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

export const relativeTime = (ms) => {
  if (!ms) return "—";
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  for (const [unit, s] of UNITS) {
    if (abs >= s || unit === "second") {
      return RTF.format(Math.round(diffSec / s), unit);
    }
  }
  return "—";
};

export const absoluteTime = (ms) => {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString();
  }
};

/* ---------- Public config ---------- */

let _publicConfigPromise = null;
export const getPublicConfig = () => {
  if (!_publicConfigPromise) {
    _publicConfigPromise = fetch("/api/config")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return _publicConfigPromise;
};

/* ---------- Markdown rendering (shared) ---------- */

export const renderMarkdown = (text) => {
  const src = String(text ?? "");
  if (typeof window.marked === "undefined" || typeof window.DOMPurify === "undefined") {
    // Fallback: escape and wrap in pre so it still renders readably.
    const escaped = src.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    return `<pre>${escaped}</pre>`;
  }
  const html = window.marked.parse(src, { gfm: true, breaks: true });
  return window.DOMPurify.sanitize(html);
};

/* ---------- Navbar ---------- */

const NAV_LINKS = [
  { href: "/", label: "Tasks", icon: "bi-list-task", match: ["/", "/index.html"] },
  { href: "/settings.html", label: "Settings", icon: "bi-gear", match: ["/settings.html"] },
];

const isActive = (link) => link.match.includes(location.pathname);

export const renderChrome = ({ pendingCount = 0 } = {}) => {
  const slot = document.getElementById("tb-chrome");
  if (!slot) return;

  const settings = loadSettings();
  const active = NAV_LINKS.find(isActive) || NAV_LINKS[0];

  slot.innerHTML = `
    <nav class="tb-navbar">
      <div class="container d-flex align-items-center gap-3">
        <a class="navbar-brand" href="/">
          <span class="tb-logo"><i class="bi bi-diagram-3-fill"></i></span>
          <span>MCP Taskbridge</span>
          <button type="button" class="tb-version-badge" id="tb-version-badge" title="View changelog">
            <span id="tb-version-label">v…</span>
          </button>
        </a>

        <button class="tb-icon-btn d-md-none ms-auto" id="tb-nav-toggle" aria-label="Toggle navigation">
          <i class="bi bi-list fs-5"></i>
        </button>

        <div class="collapse d-md-flex flex-grow-1 align-items-center" id="tb-nav-links">
          <ul class="navbar-nav d-md-flex flex-row gap-1 mb-0 ms-md-3">
            ${NAV_LINKS.map((l) => `
              <li class="nav-item">
                <a class="nav-link ${isActive(l) ? "active" : ""}" href="${l.href}">
                  <i class="bi ${l.icon} me-1"></i>${l.label}
                </a>
              </li>
            `).join("")}
          </ul>

          <div class="tb-nav-actions ms-md-auto mt-2 mt-md-0">
            <span id="tb-pending-badge" class="tb-agent-badge" title="Pending tasks">
              <i class="bi bi-hourglass-split"></i>
              <span id="tb-pending-count">${pendingCount}</span>
              <span class="tb-label">pending</span>
            </span>

            <button type="button" class="tb-icon-btn" id="tb-prompts-btn" title="Prompt library" aria-label="Prompt library">
              <i class="bi bi-magic"></i>
            </button>

            <div class="dropdown">
              <button class="tb-icon-btn" data-bs-toggle="dropdown" aria-label="Theme" title="Theme">
                <i class="bi ${themeIcon(settings.theme)}"></i>
              </button>
              <ul class="dropdown-menu dropdown-menu-end">
                ${["auto", "light", "dark", "dim"].map((t) => `
                  <li>
                    <button class="dropdown-item d-flex align-items-center gap-2" data-theme="${t}">
                      <i class="bi ${themeIcon(t)}"></i>
                      <span class="text-capitalize">${t}</span>
                      ${settings.theme === t ? '<i class="bi bi-check2 ms-auto"></i>' : ""}
                    </button>
                  </li>
                `).join("")}
              </ul>
            </div>

            <a class="tb-icon-btn" href="/settings.html" title="Settings" aria-label="Settings">
              <i class="bi bi-gear"></i>
            </a>

            <a class="tb-icon-btn" href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer" title="MCP docs" aria-label="MCP docs">
              <i class="bi bi-box-arrow-up-right"></i>
            </a>
          </div>
        </div>
      </div>
    </nav>
  `;

  // Theme dropdown wiring
  slot.querySelectorAll("[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-theme");
      saveSettings({ theme: next });
      applyTheme(next);
      renderChrome({ pendingCount: Number(document.getElementById("tb-pending-count")?.textContent || 0) });
    });
  });

  // Mobile nav toggle
  const toggle = slot.querySelector("#tb-nav-toggle");
  const links = slot.querySelector("#tb-nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("show"));
  }

  // Version badge: fill from /api/config, click opens changelog modal
  const versionBtn = slot.querySelector("#tb-version-badge");
  const versionLabel = slot.querySelector("#tb-version-label");
  if (versionBtn && versionLabel) {
    getPublicConfig().then((cfg) => {
      versionLabel.textContent = cfg.version ? `v${cfg.version}` : "dev";
    });
    versionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openChangelogModal();
    });
  }

  ensureChangelogModal();
  ensurePromptsModal();

  // Prompt library button
  const promptsBtn = slot.querySelector("#tb-prompts-btn");
  if (promptsBtn) {
    promptsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openPromptsModal();
    });
  }
};

const themeIcon = (t) => ({
  auto: "bi-circle-half",
  light: "bi-sun",
  dark: "bi-moon-stars",
  dim: "bi-moon",
}[t] || "bi-circle-half");

export const setPendingCount = (n) => {
  const el = document.getElementById("tb-pending-count");
  if (el) el.textContent = String(n);
};

/* ---------- Toast ---------- */

let toastEl = null;
let toastTimer = null;

export const toast = (message) => {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "tb-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
};

/* ---------- Changelog modal ---------- */

const CHANGELOG_MODAL_ID = "tb-changelog-modal";
let _changelogLoaded = false;

const ensureChangelogModal = () => {
  if (document.getElementById(CHANGELOG_MODAL_ID)) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal fade" id="${CHANGELOG_MODAL_ID}" tabindex="-1" aria-hidden="true" aria-labelledby="tb-changelog-title">
      <div class="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="tb-changelog-title">
              <i class="bi bi-clock-history me-2"></i>Changelog
              <span class="tb-version-badge ms-2" id="tb-changelog-version">v…</span>
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="tb-changelog-body" class="tb-prose">
              <div class="text-center text-body-secondary py-4">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>Loading changelog…
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <a href="/api/changelog" target="_blank" rel="noreferrer" class="btn btn-sm btn-outline-secondary me-auto">
              <i class="bi bi-file-earmark-text me-1"></i>Raw
            </a>
            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild);
};

const openChangelogModal = async () => {
  ensureChangelogModal();
  const modalEl = document.getElementById(CHANGELOG_MODAL_ID);
  const body = document.getElementById("tb-changelog-body");
  const vLabel = document.getElementById("tb-changelog-version");

  const cfg = await getPublicConfig();
  if (vLabel) vLabel.textContent = cfg.version ? `v${cfg.version}` : "dev";

  if (!_changelogLoaded) {
    try {
      const res = await fetch("/api/changelog");
      const md = await res.text();
      body.innerHTML = renderMarkdown(md);
      _changelogLoaded = true;
    } catch (err) {
      body.innerHTML = `<div class="text-danger">Failed to load changelog: ${err.message}</div>`;
    }
  }

  // Bootstrap 5 global is on window (loaded via bundle).
  const instance = window.bootstrap?.Modal?.getOrCreateInstance(modalEl);
  instance?.show();
};

/* ---------- Prompt library modal ---------- */

const PROMPTS_MODAL_ID = "tb-prompts-modal";
const promptState = {
  active: PROMPT_TEMPLATES[0]?.id,
  vars: {}, // taskId-scoped vars; flat map keyed by template.variable key
};

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
);

const ensurePromptsModal = () => {
  if (document.getElementById(PROMPTS_MODAL_ID)) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal fade" id="${PROMPTS_MODAL_ID}" tabindex="-1" aria-hidden="true" aria-labelledby="tb-prompts-title">
      <div class="modal-dialog modal-xl modal-dialog-scrollable modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="tb-prompts-title">
              <i class="bi bi-magic me-2"></i>Prompt library
              <span class="tb-subtle-inline ms-2">copy into Cowork / Claude Desktop / any MCP client</span>
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body p-0">
            <div class="tb-prompts-layout">
              <aside class="tb-prompts-sidebar" id="tb-prompts-sidebar"></aside>
              <section class="tb-prompts-main" id="tb-prompts-main"></section>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild);
};

const renderPromptsSidebar = () => {
  const side = document.getElementById("tb-prompts-sidebar");
  if (!side) return;
  side.innerHTML = PROMPT_TEMPLATES.map((t) => `
    <button type="button" class="tb-prompt-item ${t.id === promptState.active ? "active" : ""}" data-tb-prompt="${t.id}">
      <div class="tb-prompt-item-title">
        <i class="bi ${t.icon}"></i>${escapeHtml(t.name)}
      </div>
      <div class="tb-prompt-item-desc">${escapeHtml(t.description)}</div>
    </button>
  `).join("");
  side.querySelectorAll("[data-tb-prompt]").forEach((el) => {
    el.addEventListener("click", () => {
      promptState.active = el.getAttribute("data-tb-prompt");
      renderPromptsSidebar();
      renderPromptsMain();
    });
  });
};

const renderPromptsMain = () => {
  const main = document.getElementById("tb-prompts-main");
  if (!main) return;
  const tpl = PROMPT_TEMPLATES.find((t) => t.id === promptState.active);
  if (!tpl) {
    main.innerHTML = `<div class="p-4 text-body-secondary">Pick a template on the left.</div>`;
    return;
  }

  const varsHtml = tpl.variables.length === 0
    ? `<div class="small text-body-secondary"><i class="bi bi-info-circle me-1"></i>This template has no variables — copy as-is.</div>`
    : tpl.variables.map((v) => {
        const val = promptState.vars[v.key] ?? "";
        const field = v.textarea
          ? `<textarea class="form-control" rows="3" data-tb-var="${v.key}" placeholder="${escapeHtml(v.placeholder || "")}">${escapeHtml(val)}</textarea>`
          : `<input type="text" class="form-control" data-tb-var="${v.key}" placeholder="${escapeHtml(v.placeholder || "")}" value="${escapeHtml(val)}">`;
        return `
          <div class="mb-2">
            <label class="form-label small text-uppercase fw-semibold text-body-secondary">
              ${escapeHtml(v.label)}${v.required ? ' <span class="text-danger">*</span>' : ""}
            </label>
            ${field}
          </div>`;
      }).join("");

  const preview = renderPromptPreview(tpl);

  main.innerHTML = `
    <div class="tb-prompts-main-inner">
      <header class="tb-prompts-header">
        <div>
          <h6 class="mb-1"><i class="bi ${tpl.icon} me-2"></i>${escapeHtml(tpl.name)}</h6>
          <div class="small text-body-secondary">${escapeHtml(tpl.description)}</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="tb-prompt-copy">
          <i class="bi bi-clipboard me-1"></i>Copy prompt
        </button>
      </header>

      ${tpl.variables.length ? `
        <section class="tb-prompts-vars">
          <div class="tb-section-label mb-2">Variables</div>
          ${varsHtml}
        </section>` : `<section class="tb-prompts-vars">${varsHtml}</section>`}

      <section class="tb-prompts-preview">
        <div class="d-flex align-items-center justify-content-between mb-1">
          <div class="tb-section-label mb-0">Preview</div>
          <div class="small text-body-secondary">${preview.chars} chars · ${preview.words} words</div>
        </div>
        <pre class="tb-codeblock tb-prompts-codeblock" id="tb-prompt-preview">${escapeHtml(preview.text)}</pre>
      </section>
    </div>
  `;

  // Wire variable inputs
  main.querySelectorAll("[data-tb-var]").forEach((el) => {
    el.addEventListener("input", (e) => {
      promptState.vars[el.getAttribute("data-tb-var")] = e.target.value;
      const p = renderPromptPreview(tpl);
      document.getElementById("tb-prompt-preview").textContent = p.text;
    });
  });

  // Copy button
  document.getElementById("tb-prompt-copy").addEventListener("click", async () => {
    const { text } = renderPromptPreview(tpl);
    const ok = await copyToClipboard(text);
    toast(ok ? "Prompt copied — paste into your AI agent" : "Copy failed — select manually");
  });
};

const renderPromptPreview = (tpl) => {
  let text;
  try {
    text = buildPrompt(tpl.id, promptState.vars);
  } catch (err) {
    text = `# error: ${err.message}`;
  }
  return { text, chars: text.length, words: text.trim().split(/\s+/).filter(Boolean).length };
};

export const openPromptsModal = ({ templateId, vars } = {}) => {
  ensurePromptsModal();
  if (templateId) promptState.active = templateId;
  if (vars) promptState.vars = { ...promptState.vars, ...vars };
  renderPromptsSidebar();
  renderPromptsMain();
  const modalEl = document.getElementById(PROMPTS_MODAL_ID);
  const instance = window.bootstrap?.Modal?.getOrCreateInstance(modalEl);
  instance?.show();
};

/* ---------- Init on import ---------- */

applyTheme(loadSettings().theme);

// Re-apply when system preference flips (only matters for "auto")
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (loadSettings().theme === "auto") applyTheme("auto");
});
