# Procurement Agent — Theme & CSS

A small design system the mail-service UI can adopt to feel like the same
product. Tech stack is intentionally light: **CSS variables + Bootstrap
5.3 utilities + Bootstrap Icons**. No build step required.

> **TL;DR for the mail-service team:** copy the CSS in
> [§ Drop-in starter](#drop-in-starter), include Bootstrap 5.3 + Bootstrap
> Icons via CDN, and you're aligned.

---

## 1. Foundations

### Typography

| Token | Value |
|---|---|
| `--tb-sans` | `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` |
| `--tb-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace` |

Headings use the system font in semibold (`600`). Body text is `400`.
Numbers, IDs, and code use `--tb-mono` (e.g. `<span class="tb-mono">`).

### Spacing

We lean on Bootstrap's spacing scale (`m-1`/`p-2`/`gap-3` etc.). Inside
custom components prefer **4 / 8 / 12 / 16 / 24** px steps.

### Radius

| Token | Value | Use for |
|---|---|---|
| `--tb-radius-sm` | `6px` | inputs, small chips |
| `--tb-radius` | `10px` | cards, panels, modals |
| `--tb-radius-pill` | `999px` | status pills |

### Shadow

| Token | Value |
|---|---|
| `--tb-shadow-sm` | `0 1px 0 rgba(27, 31, 36, 0.04)` (default cards) |
| `--tb-shadow` | `0 8px 24px rgba(140, 149, 159, 0.2)` (elevated, dropdowns) |

---

## 2. Themes & color tokens

Three themes ship: `light`, `dark`, `dim` (GitHub-style mid-grey). Set on
the root element: `<html data-theme="dark">`. There is also `auto`,
which picks `light`/`dark` based on `prefers-color-scheme`.

### Surface tokens (per theme)

| Token | Light | Dark | Dim |
|---|---|---|---|
| `--tb-surface` | `#ffffff` | `#0d1117` | `#2d333b` |
| `--tb-surface-alt` | `#f6f8fa` | `#161b22` | `#373e47` |
| `--tb-border` | `#d0d7de` | `#30363d` | `#444c56` |
| `--tb-muted` | `#656d76` | `#8b949e` | `#768390` |
| `--tb-accent` | `#0969da` | `#58a6ff` | `#539bf5` |

### Semantic tokens (Bootstrap-compatible)

We override the Bootstrap variables so `btn-primary`, `text-success`,
etc. inherit the theme:

| Bootstrap var | Mapped to (light / dark) |
|---|---|
| `--bs-primary` | `#0969da` / `#58a6ff` |
| `--bs-success` | `#1a7f37` / `#57ab5a` |
| `--bs-warning` | `#9a6700` / `#daaa3f` |
| `--bs-danger`  | `#cf222e` / `#e5534b` |
| `--bs-info`    | `#0969da` / `#6cb6ff` |

---

## 3. Status pills

Statuses are rendered as small rounded pills that share one CSS shape and
differ only by color. The base class is `.tb-pill`, modifiers are
`.tb-pill-<status>`.

### Shape

```css
.tb-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: var(--tb-radius-pill);
  border: 1px solid transparent;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
}
```

### Color recipe

Pick from the semantic palette. Each pill uses **text color**,
**translucent background**, **soft border**:

| Status word     | Text (light) | Bg (light)   | Text (dark) | Bg (dark)              |
|-----------------|--------------|--------------|-------------|------------------------|
| `pending_*`     | `#9a6700`    | `#fff8c5`    | `#daaa3f`   | `rgba(218,170,63,.12)` |
| `*_in_progress` | `#0969da`    | `#ddf4ff`    | `#539bf5`   | `rgba(83,155,245,.14)` |
| `replied`       | `#0969da`    | `#ddf4ff`    | `#539bf5`   | `rgba(83,155,245,.14)` |
| `expired`       | `#9a6700`    | `#fff8c5`    | `#daaa3f`   | `rgba(218,170,63,.12)` |
| `completed`     | `#1a7f37`    | `#dafbe1`    | `#57ab5a`   | `rgba(87,171,90,.12)`  |
| `rfx_complete`  | `#1a7f37`    | `#dafbe1`    | `#57ab5a`   | `rgba(87,171,90,.12)`  |
| `cancelled`     | `--tb-muted` | `--tb-surface-alt` | `--tb-muted` | `--tb-surface-alt` |
| `rejected`      | `#cf222e`    | `#ffebe9`    | `#e5534b`   | `rgba(229,83,75,.12)`  |
| `failed`        | `#cf222e`    | `#ffebe9`    | `#e5534b`   | `rgba(229,83,75,.12)`  |

> **Visual rule**: warm hues for "waiting", blue for "in flight", green
> for "done", red for "bad", grey for "ignored". Same hue across all
> three layers of the status hierarchy so users can scan the page.

### Optional motion

The "in flight" pill (e.g. `awaiting_reply`, `in_progress`) gets a soft
breathing pulse to communicate liveness. Disabled under
`prefers-reduced-motion`.

```css
.tb-pill-in_progress {
  animation: tb-pulse-pill 2.4s ease-in-out infinite;
}
@keyframes tb-pulse-pill {
  0%, 100% { box-shadow: 0 0 0 0 rgba(83,155,245,0); }
  50%      { box-shadow: 0 0 0 6px rgba(83,155,245,.10); }
}
@media (prefers-reduced-motion: reduce) {
  .tb-pill-in_progress { animation: none; }
}
```

---

## 4. Components

### Card

```html
<div class="tb-card">
  <div class="tb-section-label">Vendor shortlist</div>
  <!-- … -->
</div>
```

```css
.tb-card {
  background: var(--tb-surface);
  border: 1px solid var(--tb-border);
  border-radius: var(--tb-radius);
  box-shadow: var(--tb-shadow-sm);
  padding: 16px;
}
.tb-section-label {
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--tb-muted);
  text-transform: uppercase;
}
```

### Buttons

Use Bootstrap `btn` with our theme overrides — `btn-primary`,
`btn-outline-primary`, `btn-outline-secondary`. Sizes: default,
`btn-sm`. Always include a Bootstrap Icon at the start:

```html
<button class="btn btn-primary">
  <i class="bi bi-send me-1"></i>Submit
</button>
```

### Inputs

```html
<input type="text" class="form-control form-control-sm" placeholder="…">
```

Size: prefer `form-control-sm` in dense lists. Add a small label above:

```html
<label class="form-label small fw-semibold">Title</label>
```

### Tables

Always wrap in a `.table-responsive`:

```html
<div class="table-responsive">
  <table class="table table-sm align-middle mb-0">
    <thead><tr><th>…</th></tr></thead>
    <tbody>…</tbody>
  </table>
</div>
```

### Modal — confirmation pattern

```html
<div class="modal fade" id="confirm-modal" tabindex="-1">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">
          <i class="bi bi-exclamation-triangle me-2 text-warning"></i>Confirm
        </h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">…</div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary" id="confirm-ok">Confirm</button>
      </div>
    </div>
  </div>
</div>
```

---

## 5. Iconography

[Bootstrap Icons 1.11+](https://icons.getbootstrap.com/). We use a
small recurring set:

| Concept | Icon |
|---|---|
| Procurement | `bi-cart3` |
| Vendor | `bi-building` |
| Email | `bi-envelope` |
| RFx open in mail app | `bi-box-arrow-up-right` |
| JSON / payload | `bi-braces` |
| Approve | `bi-check-lg` / `bi-check-circle` |
| Reject / cancel | `bi-x-lg` / `bi-slash-circle` |
| Pending | `bi-hourglass-split` / `bi-clock` |
| In progress | `bi-arrow-repeat` (auto-spins inside `.tb-pill-in_progress`) |
| Failed | `bi-exclamation-triangle` |
| Edit | `bi-pencil` |
| Delete | `bi-trash` |
| Filter / list | `bi-funnel` / `bi-list` |

---

## 6. Currency & numbers

Use the host page's active currency. The dashboard ships
`getActiveCurrency()` and `formatMoney(amount, fromCurrency)` helpers in
`assets/chrome.js`. The mail-service UI can hit `/api/currency/rates` on
the core service when it needs conversion (or replicate the same shape
locally).

```js
new Intl.NumberFormat(undefined, {
  style: "currency", currency: "USD", maximumFractionDigits: 2
}).format(12345.6);
```

Currency dropdown markup if you want to mirror our header:

```html
<div class="dropdown">
  <button class="tb-icon-btn" data-bs-toggle="dropdown">
    <span class="tb-currency-label">USD</span>
  </button>
  <ul class="dropdown-menu dropdown-menu-end">
    <li><button class="dropdown-item" data-currency="USD">USD</button></li>
    <li><button class="dropdown-item" data-currency="THB">THB</button></li>
    <li><button class="dropdown-item" data-currency="EUR">EUR</button></li>
  </ul>
</div>
```

---

## 7. Drop-in starter

A single CSS file you can serve from your service. Include after
Bootstrap 5.3.

```html
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
<link href="/assets/procurement-theme.css" rel="stylesheet">

<!-- Theme is set on <html>; switch with: document.documentElement.dataset.theme = 'dark' -->
<script>document.documentElement.dataset.theme = "auto";</script>
```

```css
/* procurement-theme.css */
:root {
  --tb-radius: 10px;
  --tb-radius-sm: 6px;
  --tb-radius-pill: 999px;
  --tb-shadow-sm: 0 1px 0 rgba(27, 31, 36, 0.04);
  --tb-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
  --tb-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --tb-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

html[data-theme="light"] {
  --tb-surface: #ffffff;
  --tb-surface-alt: #f6f8fa;
  --tb-border: #d0d7de;
  --tb-muted: #656d76;
  --tb-accent: #0969da;
}

html[data-theme="dark"] {
  --tb-surface: #0d1117;
  --tb-surface-alt: #161b22;
  --tb-border: #30363d;
  --tb-muted: #8b949e;
  --tb-accent: #58a6ff;
  --bs-body-bg: var(--tb-surface);
  --bs-body-color: #c9d1d9;
}

html[data-theme="dim"] {
  --tb-surface: #2d333b;
  --tb-surface-alt: #373e47;
  --tb-border: #444c56;
  --tb-muted: #768390;
  --tb-accent: #539bf5;
  --bs-body-bg: #22272e;
  --bs-body-color: #adbac7;
}

@media (prefers-color-scheme: dark) {
  html[data-theme="auto"] {
    --tb-surface: #0d1117;
    --tb-surface-alt: #161b22;
    --tb-border: #30363d;
    --tb-muted: #8b949e;
    --tb-accent: #58a6ff;
    --bs-body-bg: var(--tb-surface);
    --bs-body-color: #c9d1d9;
  }
}

body {
  font-family: var(--tb-sans);
  background: var(--bs-body-bg, var(--tb-surface));
  color: var(--bs-body-color, var(--tb-muted));
}

.tb-mono { font-family: var(--tb-mono); font-size: 0.85em; }

/* Cards & sections */
.tb-card {
  background: var(--tb-surface);
  border: 1px solid var(--tb-border);
  border-radius: var(--tb-radius);
  box-shadow: var(--tb-shadow-sm);
  padding: 16px;
}
.tb-section-label {
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--tb-muted);
  text-transform: uppercase;
  margin-bottom: 8px;
}

/* Status pills */
.tb-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: var(--tb-radius-pill);
  border: 1px solid transparent;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
}
.tb-pill-pending,    .tb-pill-pending_approval, .tb-pill-pending_send,
.tb-pill-pending_rfx, .tb-pill-expired         { color: #9a6700; background: #fff8c5; border-color: #d4a72c55; }
.tb-pill-in_progress, .tb-pill-awaiting_reply, .tb-pill-replied,
.tb-pill-rfx_in_progress                       { color: #0969da; background: #ddf4ff; border-color: #54aeff55; }
.tb-pill-completed, .tb-pill-rfx_complete, .tb-pill-done
                                               { color: #1a7f37; background: #dafbe1; border-color: #4ac26b55; }
.tb-pill-cancelled                             { color: var(--tb-muted); background: var(--tb-surface-alt); border-color: var(--tb-border); }
.tb-pill-rejected, .tb-pill-failed             { color: #cf222e; background: #ffebe9; border-color: #ff818255; }

/* Dark/dim equivalents */
html[data-theme="dark"] .tb-pill-pending,    html[data-theme="dim"] .tb-pill-pending,
html[data-theme="dark"] .tb-pill-pending_approval, html[data-theme="dim"] .tb-pill-pending_approval,
html[data-theme="dark"] .tb-pill-pending_send,     html[data-theme="dim"] .tb-pill-pending_send,
html[data-theme="dark"] .tb-pill-pending_rfx,      html[data-theme="dim"] .tb-pill-pending_rfx,
html[data-theme="dark"] .tb-pill-expired,          html[data-theme="dim"] .tb-pill-expired
{ color: #daaa3f; background: rgba(218,170,63,.12); border-color: rgba(218,170,63,.35); }

html[data-theme="dark"] .tb-pill-in_progress,    html[data-theme="dim"] .tb-pill-in_progress,
html[data-theme="dark"] .tb-pill-awaiting_reply, html[data-theme="dim"] .tb-pill-awaiting_reply,
html[data-theme="dark"] .tb-pill-replied,        html[data-theme="dim"] .tb-pill-replied
{ color: #539bf5; background: rgba(83,155,245,.14); border-color: rgba(83,155,245,.45); }

html[data-theme="dark"] .tb-pill-completed,     html[data-theme="dim"] .tb-pill-completed,
html[data-theme="dark"] .tb-pill-rfx_complete,  html[data-theme="dim"] .tb-pill-rfx_complete
{ color: #57ab5a; background: rgba(87,171,90,.12); border-color: rgba(87,171,90,.35); }

html[data-theme="dark"] .tb-pill-rejected, html[data-theme="dim"] .tb-pill-rejected,
html[data-theme="dark"] .tb-pill-failed,   html[data-theme="dim"] .tb-pill-failed
{ color: #e5534b; background: rgba(229,83,75,.12); border-color: rgba(229,83,75,.35); }

/* Live pulse for "in flight" — auto-disabled with reduced motion */
.tb-pill-in_progress, .tb-pill-awaiting_reply {
  animation: tb-pulse-pill 2.4s ease-in-out infinite;
}
@keyframes tb-pulse-pill {
  0%, 100% { box-shadow: 0 0 0 0 rgba(83,155,245,0); }
  50%      { box-shadow: 0 0 0 6px rgba(83,155,245,.10); }
}
@media (prefers-reduced-motion: reduce) {
  .tb-pill-in_progress, .tb-pill-awaiting_reply { animation: none; }
}

/* Buttons — Bootstrap-compatible accent override */
.btn-primary {
  --bs-btn-bg: var(--tb-accent);
  --bs-btn-border-color: var(--tb-accent);
  --bs-btn-hover-bg: color-mix(in srgb, var(--tb-accent) 86%, white);
  --bs-btn-hover-border-color: color-mix(in srgb, var(--tb-accent) 86%, white);
}
.btn-outline-primary {
  --bs-btn-color: var(--tb-accent);
  --bs-btn-border-color: var(--tb-accent);
  --bs-btn-hover-bg: var(--tb-accent);
}

/* Small icon button used throughout the chrome */
.tb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--tb-border);
  background: var(--tb-surface);
  color: var(--bs-body-color);
  border-radius: var(--tb-radius-sm);
  padding: 6px 10px;
  font-size: 0.9rem;
}
.tb-icon-btn:hover { background: var(--tb-surface-alt); }
```

---

## 8. Example: status pill in HTML

```html
<!-- Replace 'completed' with any status: rfx_complete, awaiting_reply, expired, … -->
<span class="tb-pill tb-pill-completed">
  <i class="bi bi-check-circle"></i>completed
</span>
```

---

## 9. Reference implementation

Live in this repo:

- Tokens & full theme: `src/transport/http/public/assets/app.css`
- Chrome (header + theme switcher + currency selector):
  `src/transport/http/public/assets/chrome.js`
- Status hierarchy + pill mapping:
  - `docs/status-model.md`
  - `src/transport/http/public/assets/procurement.js` (`STATUS_ICON` map)
  - `src/transport/http/public/assets/procurement-detail.js`

If you mirror the tokens in §7 your UI will line up pixel-for-pixel
across themes.
