/* Browser-side module — we run it directly under node:test
   because it has no DOM dependencies. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PROMPT_TEMPLATES,
  PROMPT_FRAGMENTS,
  buildPrompt,
  getTemplate,
} from "../src/transport/http/public/assets/prompts.js";

test("PROMPT_TEMPLATES: every template has the required public shape", () => {
  for (const tpl of PROMPT_TEMPLATES) {
    assert.equal(typeof tpl.id, "string");
    assert.match(tpl.id, /^[a-z][a-z0-9-]*$/);
    assert.equal(typeof tpl.name, "string");
    assert.equal(typeof tpl.description, "string");
    assert.equal(typeof tpl.icon, "string");
    assert.ok(Array.isArray(tpl.variables));
    assert.equal(typeof tpl.build, "function");
  }
});

test("PROMPT_TEMPLATES: ids are unique", () => {
  const ids = PROMPT_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("buildPrompt('source-oldest'): returns non-empty markdown ending in newline", () => {
  const out = buildPrompt("source-oldest");
  assert.ok(out.length > 200);
  assert.ok(out.endsWith("\n"));
  assert.match(out, /list_pending_tasks/);
  assert.match(out, /claim_task/);
  assert.match(out, /submit_result/);
  assert.match(out, /search_vendors/);
  assert.match(out, /submit_vendor_shortlist/);
});

test("buildPrompt('source-oldest'): includes shared fragments", () => {
  const out = buildPrompt("source-oldest");
  assert.ok(out.includes(PROMPT_FRAGMENTS.metadataNudge));
  assert.ok(out.includes(PROMPT_FRAGMENTS.failureRule));
  assert.ok(out.includes(PROMPT_FRAGMENTS.resultFormat));
});

test("buildPrompt('source-pr'): interpolates PR_ID", () => {
  const out = buildPrompt("source-pr", { PR_ID: "abc-123-xyz" });
  assert.ok(out.includes("`abc-123-xyz`"));
  assert.ok(out.includes(PROMPT_FRAGMENTS.metadataNudge));
  assert.match(out, /get_purchase_request/);
  assert.match(out, /search_vendors/);
});

test("buildPrompt('triage'): is read-only and does NOT allow claiming", () => {
  const out = buildPrompt("triage");
  assert.match(out, /list_pending_tasks/);
  assert.match(out, /Do \*\*not\*\* call.*claim_task/);
});

test("buildPrompt('fail-with-reason'): interpolates TASK_ID and REASON", () => {
  const out = buildPrompt("fail-with-reason", {
    TASK_ID: "task-9",
    REASON: "Out of scope: contains a credential request.",
  });
  assert.ok(out.includes("`task-9`"));
  assert.ok(out.includes("Out of scope: contains a credential request."));
  assert.match(out, /Do \*\*not\*\* claim, submit/);
});

test("buildPrompt: throws on unknown template id", () => {
  assert.throws(() => buildPrompt("does-not-exist"), /unknown prompt template/);
});

test("getTemplate: returns the same instance from PROMPT_TEMPLATES", () => {
  const tpl = getTemplate("source-oldest");
  assert.ok(tpl);
  assert.equal(tpl.id, "source-oldest");
});

test("DRY: every operational prompt that claims includes the metadata nudge", () => {
  const ops = ["source-oldest", "source-pr"];
  for (const id of ops) {
    const out = buildPrompt(id, { PR_ID: "x" });
    assert.ok(out.includes(PROMPT_FRAGMENTS.metadataNudge),
      `${id} should include the shared metadata nudge`);
  }
});
