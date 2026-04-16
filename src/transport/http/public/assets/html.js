/* ============================================================
   html`` — safe HTML tagged template.

   Auto-escapes every interpolation unless it's explicitly wrapped
   with raw(). Arrays are joined. null / undefined / false collapse
   to empty string. Nested html`` results are trusted because they
   came from this same function.

   Usage:
     html`<div class="x">${user.name}</div>`           // escaped
     html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`  // nested
     html`<div>${raw(trustedMarkdownHtml)}</div>`      // opt-in raw
   ============================================================ */

const RAW = Symbol("tb.html.raw");

/** Plain HTML escape — use this inside raw() builders too. */
export const escape = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/**
 * Wrap a trusted HTML fragment (e.g. output from DOMPurify + marked)
 * so html`` won't escape it a second time.
 */
export const raw = (value) => ({ [RAW]: true, value: String(value ?? "") });

const interpolate = (value) => {
  if (value == null || value === false || value === true) return "";
  if (typeof value === "object" && value[RAW]) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  return escape(value);
};

export const html = (strings, ...values) => {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += interpolate(values[i]);
  }
  // Wrap the result so further interpolation into another html``
  // doesn't double-escape it.
  return raw(out);
};

/** Extract the plain string from an html`` result (for innerHTML assignment). */
export const toString = (value) =>
  value && typeof value === "object" && value[RAW] ? value.value : String(value ?? "");
