/* ============================================================
   New PR form — dynamic line items, validation, draft/submit.
   ============================================================ */

import { renderChrome, loadSettings, applyTheme, toast } from "./chrome.js";
import { html, raw, toString, escape } from "./html.js";

/* ---------- State ---------- */

let lineItems = [];
let nextItemId = 1;

/* ---------- API ---------- */

const api = async (url, init = {}) => {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  return body;
};

/* ---------- Line item rendering ---------- */

const renderLineItem = (item) => html`
  <div class="tb-line-item-row" data-item-id="${item.id}">
    <div class="row g-2 align-items-end">
      <div class="col-md-3">
        <label class="form-label small">Material name <span class="text-danger">*</span></label>
        <input type="text" class="form-control form-control-sm" name="material_name"
               value="${item.material_name || ""}" required placeholder="e.g. A4 paper" />
      </div>
      <div class="col-md-3">
        <label class="form-label small">Specification</label>
        <input type="text" class="form-control form-control-sm" name="specification"
               value="${item.specification || ""}" placeholder="e.g. 80gsm white" />
      </div>
      <div class="col-md-2">
        <label class="form-label small">Quantity <span class="text-danger">*</span></label>
        <input type="number" class="form-control form-control-sm" name="quantity"
               value="${item.quantity || ""}" required min="1" placeholder="0" />
      </div>
      <div class="col-md-2">
        <label class="form-label small">Unit</label>
        <input type="text" class="form-control form-control-sm" name="unit"
               value="${item.unit || ""}" placeholder="e.g. ream" />
      </div>
      <div class="col-md-2 d-flex align-items-end">
        <button type="button" class="btn btn-outline-danger btn-sm w-100" data-action="remove-item" data-item-id="${item.id}">
          <i class="bi bi-trash me-1"></i>Remove
        </button>
      </div>
    </div>
  </div>
`;

const renderAllLineItems = () => {
  const container = document.getElementById("pr-line-items");
  const emptyMsg = document.getElementById("pr-items-empty");
  if (!container) return;

  container.innerHTML = toString(html`${lineItems.map(renderLineItem)}`);
  if (emptyMsg) emptyMsg.classList.toggle("d-none", lineItems.length > 0);
};

/* ---------- Collect form data ---------- */

const collectItems = () => {
  const rows = document.querySelectorAll(".tb-line-item-row");
  const items = [];
  for (const row of rows) {
    const itemId = row.getAttribute("data-item-id");
    const get = (name) => row.querySelector(`[name="${name}"]`)?.value?.trim() || "";
    items.push({
      id: itemId,
      material_name: get("material_name"),
      specification: get("specification"),
      quantity: Number(get("quantity")) || 0,
      unit: get("unit"),
    });
  }
  return items;
};

const syncItemState = () => {
  const collected = collectItems();
  for (const c of collected) {
    const existing = lineItems.find((li) => String(li.id) === String(c.id));
    if (existing) Object.assign(existing, c);
  }
};

/* ---------- Validation ---------- */

const validateForm = (requireItems = true) => {
  const form = document.getElementById("pr-form");
  const titleEl = document.getElementById("pr-title");
  let valid = true;

  // Bootstrap validation classes
  form.classList.add("was-validated");

  if (!titleEl?.value?.trim()) {
    titleEl?.classList.add("is-invalid");
    valid = false;
  } else {
    titleEl?.classList.remove("is-invalid");
  }

  if (requireItems && lineItems.length === 0) {
    toast("Add at least one line item");
    valid = false;
  }

  // Validate line items
  if (lineItems.length > 0) {
    const rows = document.querySelectorAll(".tb-line-item-row");
    for (const row of rows) {
      const matEl = row.querySelector('[name="material_name"]');
      const qtyEl = row.querySelector('[name="quantity"]');
      if (!matEl?.value?.trim()) { matEl?.classList.add("is-invalid"); valid = false; }
      else matEl?.classList.remove("is-invalid");
      if (!qtyEl?.value || Number(qtyEl.value) < 1) { qtyEl?.classList.add("is-invalid"); valid = false; }
      else qtyEl?.classList.remove("is-invalid");
    }
  }

  return valid;
};

/* ---------- Submit ---------- */

const submitPr = async (asDraft) => {
  syncItemState();

  if (!asDraft && !validateForm(true)) return;
  if (asDraft && !document.getElementById("pr-title")?.value?.trim()) {
    toast("A title is required even for drafts");
    return;
  }

  const title = document.getElementById("pr-title").value.trim();
  const deadline = document.getElementById("pr-deadline")?.value || null;
  const notes = document.getElementById("pr-notes")?.value?.trim() || null;
  const filesEl = document.getElementById("pr-files");
  const files = filesEl?.files?.length > 0 ? Array.from(filesEl.files) : null;

  const items = collectItems().filter((i) => i.material_name);

  const loadingEl = document.getElementById("pr-form-loading");
  const formEl = document.getElementById("pr-form");

  // Show loading
  if (loadingEl) loadingEl.classList.remove("d-none");
  const btns = formEl?.querySelectorAll("button");
  btns?.forEach((b) => b.disabled = true);

  try {
    let result;

    if (files) {
      // Use FormData for file uploads
      const fd = new FormData();
      fd.append("title", title);
      if (deadline) fd.append("deadline", deadline);
      if (notes) fd.append("notes", notes);
      fd.append("items", JSON.stringify(items));
      fd.append("status", asDraft ? "draft" : "pending_approval");
      for (const f of files) fd.append("files", f);

      const res = await fetch("/api/procurement/prs", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
      result = body;
    } else {
      result = await api("/api/procurement/prs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          deadline,
          notes,
          items,
          status: asDraft ? "draft" : "pending_approval",
        }),
      });
    }

    toast(asDraft ? "Draft saved" : "PR submitted for approval");

    // If we got an id, redirect to detail page; otherwise go to list.
    const newId = result?.id || result?.pr?.id;
    if (newId) {
      location.href = `/procurement-detail.html?id=${newId}`;
    } else {
      location.href = "/";
    }
  } catch (err) {
    toast(err.message || "Failed to save PR");
    console.error("[pr-form]", err);
  } finally {
    if (loadingEl) loadingEl.classList.add("d-none");
    btns?.forEach((b) => b.disabled = false);
  }
};

/* ---------- Event wiring ---------- */

const bindEvents = () => {
  // Add item
  const addBtn = document.getElementById("pr-add-item");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      syncItemState();
      lineItems.push({
        id: nextItemId++,
        material_name: "",
        specification: "",
        quantity: "",
        unit: "",
      });
      renderAllLineItems();
      // Focus the new row's first input
      const lastRow = document.querySelector(".tb-line-item-row:last-child");
      lastRow?.querySelector('input[name="material_name"]')?.focus();
    });
  }

  // Remove item (delegated)
  const itemsContainer = document.getElementById("pr-line-items");
  if (itemsContainer) {
    itemsContainer.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action='remove-item']");
      if (!target) return;
      const itemId = target.getAttribute("data-item-id");
      syncItemState();
      lineItems = lineItems.filter((li) => String(li.id) !== String(itemId));
      renderAllLineItems();
    });
  }

  // Save as draft
  const draftBtn = document.getElementById("pr-save-draft");
  if (draftBtn) {
    draftBtn.addEventListener("click", (e) => {
      e.preventDefault();
      submitPr(true);
    });
  }

  // Submit for approval
  const form = document.getElementById("pr-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitPr(false);
    });
  }
};

/* ---------- Boot ---------- */

const boot = () => {
  const settings = loadSettings();
  applyTheme(settings.theme);
  renderChrome();
  renderAllLineItems();
  bindEvents();
};

boot();
