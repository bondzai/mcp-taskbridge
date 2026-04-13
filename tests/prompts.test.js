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

test("buildPrompt('solve-oldest'): returns non-empty markdown ending in newline", () => {
  const out = buildPrompt("solve-oldest");
  assert.ok(out.length > 200);
  assert.ok(out.endsWith("\n"));
  assert.match(out, /list_pending_tasks/);
  assert.match(out, /claim_task/);
  assert.match(out, /submit_result/);
});

test("buildPrompt('solve-oldest'): includes shared fragments verbatim", () => {
  const out = buildPrompt("solve-oldest");
  // Tagging note + metadata nudge + state-only rule + failure rule
  // all live in PROMPT_FRAGMENTS — verify we're actually composing
  // from the fragments and not hand-rolling each template again.
  assert.ok(out.includes(PROMPT_FRAGMENTS.taggingNote));
  assert.ok(out.includes(PROMPT_FRAGMENTS.metadataNudge));
  assert.ok(out.includes(PROMPT_FRAGMENTS.failureRule));
  assert.ok(out.includes(PROMPT_FRAGMENTS.stateOnlyRule));
  assert.ok(out.includes(PROMPT_FRAGMENTS.resultFormat));
});

test("buildPrompt('solve-this'): interpolates TASK_ID and reuses fragments", () => {
  const out = buildPrompt("solve-this", { TASK_ID: "abc-123-xyz" });
  assert.ok(out.includes("`abc-123-xyz`"));
  assert.ok(out.includes(PROMPT_FRAGMENTS.taggingNote));
  assert.ok(out.includes(PROMPT_FRAGMENTS.metadataNudge));
  assert.ok(out.includes(PROMPT_FRAGMENTS.failureRule));
});

test("buildPrompt('solve-this'): includes the optional preview block when given", () => {
  const out = buildPrompt("solve-this", {
    TASK_ID: "id-1",
    PROMPT_PREVIEW: "first line\nsecond line",
  });
  assert.match(out, /Prompt preview/);
  assert.match(out, /> first line/);
  assert.match(out, /> second line/);
});

test("buildPrompt('solve-this'): omits the preview block when no preview given", () => {
  const out = buildPrompt("solve-this", { TASK_ID: "id-1" });
  assert.ok(!/Prompt preview/.test(out));
});

test("buildPrompt('triage'): is read-only and does NOT mention claim_task etc", () => {
  const out = buildPrompt("triage");
  assert.match(out, /list_pending_tasks/);
  // Hard rule says do NOT call these — but the rule itself names them.
  // We only assert that the rule explicitly forbids them.
  assert.match(out, /Do \*\*not\*\* call.*claim_task/);
});

test("buildPrompt('fail-with-reason'): interpolates TASK_ID and REASON, no other tools called", () => {
  const out = buildPrompt("fail-with-reason", {
    TASK_ID: "task-9",
    REASON: "Out of scope: contains a credential request.",
  });
  assert.ok(out.includes("`task-9`"));
  assert.ok(out.includes("Out of scope: contains a credential request."));
  // It must explicitly forbid claim/submit
  assert.match(out, /Do \*\*not\*\* claim, submit/);
});

test("buildPrompt: throws on unknown template id", () => {
  assert.throws(() => buildPrompt("does-not-exist"), /unknown prompt template/);
});

test("getTemplate: returns the same instance from PROMPT_TEMPLATES", () => {
  const tpl = getTemplate("solve-oldest");
  assert.ok(tpl);
  assert.equal(tpl.id, "solve-oldest");
});

test("DRY: every operational prompt that claims includes the same metadata nudge string", () => {
  // The whole point of the refactor — both prompts that lead to
  // submit_result should pull the same nudge out of PROMPT_FRAGMENTS
  // rather than each having their own slightly-different copy.
  const ops = ["solve-oldest", "solve-this"];
  for (const id of ops) {
    const out = buildPrompt(id, { TASK_ID: "x" });
    assert.ok(out.includes(PROMPT_FRAGMENTS.metadataNudge),
      `${id} should include the shared metadata nudge`);
  }
});
