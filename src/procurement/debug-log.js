/**
 * In-memory debug log per PR — captures agent submissions, decision engine
 * output, email service responses, and errors. Last 50 entries per PR.
 */

const MAX_ENTRIES = 50;
const log = new Map(); // prId → array of entries

export const debugLog = {
  add(prId, type, data) {
    if (!prId) return;
    const list = log.get(prId) || [];
    list.push({
      ts: Date.now(),
      type, // "submit_shortlist" | "decision_engine" | "email_send" | "email_response" | "vendor_created" | "error"
      data,
    });
    if (list.length > MAX_ENTRIES) list.shift();
    log.set(prId, list);
  },

  get(prId) {
    return log.get(prId) || [];
  },

  clear(prId) {
    if (prId) log.delete(prId);
    else log.clear();
  },
};
