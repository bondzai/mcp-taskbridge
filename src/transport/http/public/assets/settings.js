/* Settings page — theme, defaults, server-info display. */

import { renderChrome, applyTheme, loadSettings, saveSettings, toast } from "./chrome.js";

const THEMES = [
  { id: "auto",  label: "Auto",  hint: "Follows system", swatch: "tb-theme-swatch-auto" },
  { id: "light", label: "Light", hint: "High contrast",  swatch: "tb-theme-swatch-light" },
  { id: "dark",  label: "Dark",  hint: "Deep black",     swatch: "tb-theme-swatch-dark" },
  { id: "dim",   label: "Dim",   hint: "Soft dark",      swatch: "tb-theme-swatch-dim" },
];

const PAGE_SIZES = [10, 25, 50, 100];
const STATUSES = ["all", "pending", "in_progress", "done", "failed"];
const SORTS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["updated", "Recently updated"],
  ["status", "By status"],
];

const escape = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
);

const renderThemes = (current) => {
  const grid = document.getElementById("tb-theme-grid");
  grid.innerHTML = THEMES.map((t) => `
    <div class="tb-theme-option ${t.id === current ? "active" : ""}" data-theme="${t.id}" role="button" tabindex="0">
      <div class="tb-theme-swatch ${t.swatch}"></div>
      <div class="d-flex align-items-center justify-content-between">
        <strong>${t.label}</strong>
        ${t.id === current ? '<i class="bi bi-check-circle-fill text-primary"></i>' : ""}
      </div>
      <div class="small text-body-secondary">${t.hint}</div>
    </div>
  `).join("");
  grid.querySelectorAll(".tb-theme-option").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-theme");
      saveSettings({ theme: id });
      applyTheme(id);
      renderThemes(id);
      renderChrome();
      toast(`Theme: ${id}`);
    });
  });
};

const fillSelect = (id, options, current) => {
  const el = document.getElementById(id);
  el.innerHTML = options.map(([v, l]) => `<option value="${v}" ${v === current ? "selected" : ""}>${escape(l)}</option>`).join("");
};

const renderDefaults = () => {
  const s = loadSettings();
  fillSelect("tb-set-pagesize", PAGE_SIZES.map((n) => [n, `${n} per page`]), s.pageSize);
  fillSelect("tb-set-status", STATUSES.map((st) => [st, st.replace("_", " ")]), s.defaultStatus);
  fillSelect("tb-set-sort", SORTS, s.defaultSort);

  document.getElementById("tb-set-pagesize").addEventListener("change", (e) => {
    saveSettings({ pageSize: Number(e.target.value) }); toast("Saved");
  });
  document.getElementById("tb-set-status").addEventListener("change", (e) => {
    saveSettings({ defaultStatus: e.target.value }); toast("Saved");
  });
  document.getElementById("tb-set-sort").addEventListener("change", (e) => {
    saveSettings({ defaultSort: e.target.value }); toast("Saved");
  });
};

const renderServerInfo = async () => {
  const dl = document.getElementById("tb-server-info");
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    const rows = [
      ["Agent id", cfg.agentId || "—"],
      ["Webhook URL", cfg.webhookUrl || "—"],
      ["Web host", cfg.webHost || "—"],
      ["Web port", cfg.webPort != null ? String(cfg.webPort) : "—"],
      ["Version", cfg.version || "—"],
    ];
    dl.innerHTML = rows.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join("");
  } catch (err) {
    dl.innerHTML = `<dt>Error</dt><dd>${escape(err.message)}</dd>`;
  }
};

document.getElementById("tb-reset").addEventListener("click", () => {
  localStorage.removeItem("taskbridge.settings.v1");
  applyTheme("auto");
  renderChrome();
  renderThemes("auto");
  renderDefaults();
  toast("Settings reset");
});

// Boot
renderChrome();
renderThemes(loadSettings().theme);
renderDefaults();
renderServerInfo();
