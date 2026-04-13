/* ============================================================
   Status page — polls /api/health every 5s and renders cards.
   ============================================================ */

import { renderChrome, relativeTime, absoluteTime, toast } from "./chrome.js";

const REFRESH_MS = 5000;
let timer = null;

const escape = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
);

const humanUptime = (ms) => {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
};

const dot = (level) => `<span class="tb-dot tb-dot-${level}"></span>`;

/* Each card returns { level: "ok" | "warn" | "bad" | "unknown", html } */

const cardWeb = (snap) => ({
  level: "ok",
  html: `
    <div class="tb-status-card">
      <header>${dot("ok")}<strong>Web server</strong></header>
      <dl>
        <div><dt>Version</dt><dd>${escape(snap.version || "—")}</dd></div>
        <div><dt>Uptime</dt><dd>${escape(humanUptime(snap.uptimeMs))}</dd></div>
        <div><dt>Started</dt><dd title="${escape(absoluteTime(snap.startedAt))}">${escape(relativeTime(snap.startedAt))}</dd></div>
      </dl>
    </div>`,
});

const cardDb = (snap) => {
  const d = snap.db || {};
  const level = d.ok ? "ok" : "bad";
  const t = d.tasks || {};
  return {
    level,
    html: `
      <div class="tb-status-card">
        <header>${dot(level)}<strong>Database</strong></header>
        <dl>
          <div><dt>Status</dt><dd>${d.ok ? "ready" : `error: ${escape(d.error || "unknown")}`}</dd></div>
          <div><dt>Journal</dt><dd>${escape(d.journalMode || "—")}</dd></div>
          <div><dt>Tasks total</dt><dd>${t.total ?? "—"}</dd></div>
        </dl>
      </div>`,
  };
};

const cardTasks = (snap) => {
  const t = (snap.db && snap.db.tasks) || {};
  return {
    level: "ok",
    html: `
      <div class="tb-status-card">
        <header>${dot("ok")}<strong>Tasks by status</strong></header>
        <div class="tb-status-pills">
          <span class="tb-pill tb-pill-pending"><i class="bi bi-hourglass-split"></i>pending ${t.pending ?? 0}</span>
          <span class="tb-pill tb-pill-in_progress"><i class="bi bi-arrow-repeat"></i>in progress ${t.in_progress ?? 0}</span>
          <span class="tb-pill tb-pill-done"><i class="bi bi-check-circle-fill"></i>done ${t.done ?? 0}</span>
          <span class="tb-pill tb-pill-failed"><i class="bi bi-x-octagon-fill"></i>failed ${t.failed ?? 0}</span>
        </div>
      </div>`,
  };
};

const cardSse = (snap) => {
  const n = snap.sse?.subscribers ?? null;
  const level = n == null ? "unknown" : n > 0 ? "ok" : "warn";
  return {
    level,
    html: `
      <div class="tb-status-card">
        <header>${dot(level)}<strong>SSE broadcaster</strong></header>
        <dl>
          <div><dt>Connected browsers</dt><dd>${n ?? "—"}</dd></div>
          <div><dt>Events emitted</dt><dd>${snap.events?.totalEmitted ?? 0}</dd></div>
        </dl>
      </div>`,
  };
};

const cardWebhook = (snap) => {
  const w = snap.webhook || {};
  const level = w.rejected > 0 ? "warn" : w.received > 0 ? "ok" : "unknown";
  return {
    level,
    html: `
      <div class="tb-status-card">
        <header>${dot(level)}<strong>Webhooks</strong></header>
        <dl>
          <div><dt>Received</dt><dd>${w.received ?? 0}</dd></div>
          <div><dt>Rejected</dt><dd>${w.rejected ?? 0}</dd></div>
          <div><dt>Last ok</dt><dd title="${escape(absoluteTime(w.lastOkAt))}">${w.lastOkAt ? escape(relativeTime(w.lastOkAt)) : "—"}</dd></div>
          <div><dt>Last reject</dt><dd title="${escape(absoluteTime(w.lastRejectedAt))}">${w.lastRejectedAt ? escape(relativeTime(w.lastRejectedAt)) : "—"}</dd></div>
        </dl>
      </div>`,
  };
};

const cardMcp = (snap) => {
  const m = snap.mcp || {};
  const levelMap = { active: "ok", idle: "warn", unknown: "unknown" };
  const level = levelMap[m.status] || "unknown";
  const blurb = {
    active: "A signed webhook arrived within the last 5 minutes — MCP process is alive and the shared secret is correct.",
    idle:   "No recent activity. MCP process may still be alive; it only runs while an MCP client is using it.",
    unknown: "Never seen a signed webhook. Either no MCP client has claimed a task yet, or the MCP process can't reach this web server.",
  }[m.status] || "";
  return {
    level,
    html: `
      <div class="tb-status-card">
        <header>${dot(level)}<strong>MCP activity</strong> <span class="tb-status-tag">${escape(m.status || "unknown")}</span></header>
        <dl>
          <div><dt>Last activity</dt><dd title="${escape(absoluteTime(m.lastActivityAt))}">${m.lastActivityAt ? escape(relativeTime(m.lastActivityAt)) : "—"}</dd></div>
        </dl>
        <p class="tb-status-blurb">${escape(blurb)}</p>
      </div>`,
  };
};

const cardEvents = (snap) => {
  const e = snap.events || {};
  const rows = [
    ["Created",   e.lastCreatedAt],
    ["Claimed",   e.lastClaimedAt],
    ["Progress",  e.lastProgressAt],
    ["Completed", e.lastCompletedAt],
    ["Failed",    e.lastFailedAt],
  ];
  return {
    level: "ok",
    html: `
      <div class="tb-status-card">
        <header>${dot("ok")}<strong>Event bus</strong></header>
        <dl>
          ${rows.map(([label, ts]) =>
            `<div><dt>Last ${label.toLowerCase()}</dt><dd title="${escape(absoluteTime(ts))}">${ts ? escape(relativeTime(ts)) : "—"}</dd></div>`
          ).join("")}
        </dl>
      </div>`,
  };
};

const LEVEL_RANK = { ok: 0, warn: 1, bad: 2, unknown: 0.5 };

const renderBanner = (overall) => {
  const banner = document.getElementById("tb-status-banner");
  const map = {
    ok:      { cls: "ok",      icon: "bi-check-circle-fill",  title: "All systems healthy",         note: "Everything the web server can observe is green." },
    warn:    { cls: "warn",    icon: "bi-exclamation-circle", title: "Degraded",                    note: "Something is worth a look — see details below." },
    bad:     { cls: "bad",     icon: "bi-x-octagon-fill",     title: "Problem detected",            note: "One or more checks failed." },
    unknown: { cls: "unknown", icon: "bi-question-circle",    title: "Partial visibility",          note: "No recent activity from MCP clients — this is normal on a fresh boot." },
  };
  const m = map[overall] || map.unknown;
  banner.className = `tb-status-banner tb-status-banner-${m.cls}`;
  banner.innerHTML = `
    <i class="bi ${m.icon}"></i>
    <div>
      <div class="tb-status-banner-title">${m.title}</div>
      <div class="tb-status-banner-note">${m.note}</div>
    </div>
  `;
};

const cardExternal = (check) => {
  const levelMap = { ok: "ok", warn: "warn", off: "unknown", bad: "bad" };
  const level = levelMap[check.level] || "unknown";
  const tag = escape(check.level || "unknown");
  const responseMs = check.responseMs != null ? `${check.responseMs} ms` : "—";
  return {
    level,
    html: `
      <div class="tb-status-card">
        <header>${dot(level)}<strong>${escape(check.label)}</strong> <span class="tb-status-tag">${tag}</span></header>
        <dl>
          <div><dt>Last checked</dt><dd title="${escape(absoluteTime(check.checkedAt))}">${check.checkedAt ? escape(relativeTime(check.checkedAt)) : "—"}</dd></div>
          <div><dt>Response</dt><dd>${escape(responseMs)}</dd></div>
          <div><dt>Kind</dt><dd>${escape(check.kind || "—")}</dd></div>
        </dl>
        ${check.message ? `<p class="tb-status-blurb"><strong>Result:</strong> ${escape(check.message)}</p>` : ""}
        ${check.hint ? `<p class="tb-status-blurb">${escape(check.hint)}</p>` : ""}
      </div>`,
  };
};

const render = (snap) => {
  const internalCards = [
    cardWeb(snap),
    cardDb(snap),
    cardTasks(snap),
    cardEvents(snap),
    cardSse(snap),
    cardWebhook(snap),
    cardMcp(snap),
  ];
  const externalCards = (snap.external || []).map(cardExternal);
  const allCards = [...internalCards, ...externalCards];
  const worst = allCards.reduce(
    (acc, c) => (LEVEL_RANK[c.level] > LEVEL_RANK[acc] ? c.level : acc),
    "ok"
  );
  renderBanner(worst);

  const grid = document.getElementById("tb-status-grid");
  grid.innerHTML = `
    <h2 class="tb-status-section-title">Web server (observed directly)</h2>
    <div class="tb-status-row">${internalCards.map((c) => c.html).join("")}</div>
    ${externalCards.length > 0 ? `
      <h2 class="tb-status-section-title mt-4">External tools (dynamic probes)</h2>
      <div class="tb-status-row">${externalCards.map((c) => c.html).join("")}</div>
    ` : ""}
  `;
};

const renderError = (err) => {
  renderBanner("bad");
  document.getElementById("tb-status-grid").innerHTML = `
    <div class="tb-status-card">
      <header>${dot("bad")}<strong>Fetch failed</strong></header>
      <p class="tb-status-blurb">${escape(err.message)}</p>
    </div>`;
};

const refresh = async () => {
  try {
    const res = await fetch("/api/health");
    const body = await res.json();
    render(body);
  } catch (err) {
    renderError(err);
  }
};

document.getElementById("tb-refresh").addEventListener("click", () => {
  refresh();
  toast("Refreshed");
});

// Boot
renderChrome();
refresh();
timer = setInterval(refresh, REFRESH_MS);
window.addEventListener("beforeunload", () => clearInterval(timer));
