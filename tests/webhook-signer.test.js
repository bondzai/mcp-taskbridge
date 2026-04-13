import test from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifySignature } from "../src/webhook/signer.js";

test("signPayload: returns sha256= prefixed hex digest", () => {
  assert.match(signPayload("secret", "hello"), /^sha256=[a-f0-9]{64}$/);
});

test("signPayload: deterministic for same input", () => {
  assert.equal(signPayload("s", "p"), signPayload("s", "p"));
});

test("signPayload: different secrets → different sigs", () => {
  assert.notEqual(signPayload("a", "x"), signPayload("b", "x"));
});

test("signPayload: rejects bad inputs", () => {
  assert.throws(() => signPayload("", "x"), /secret/);
  assert.throws(() => signPayload("s", 123), /string/);
});

test("verifySignature: accepts correct signature", () => {
  const payload = JSON.stringify({ hello: "world" });
  const sig = signPayload("topsecret", payload);
  assert.equal(verifySignature("topsecret", payload, sig), true);
});

test("verifySignature: rejects tampered payload", () => {
  const sig = signPayload("topsecret", "original");
  assert.equal(verifySignature("topsecret", "tampered", sig), false);
});

test("verifySignature: rejects wrong secret", () => {
  const sig = signPayload("a", "payload");
  assert.equal(verifySignature("b", "payload", sig), false);
});

test("verifySignature: rejects missing/garbage inputs", () => {
  assert.equal(verifySignature("", "p", "s"), false);
  assert.equal(verifySignature("s", "", "s"), false);
  assert.equal(verifySignature("s", "p", ""), false);
  assert.equal(verifySignature("s", "p", "no-prefix"), false);
  assert.equal(verifySignature("s", "p", "sha256=deadbeef"), false);
  assert.equal(verifySignature("s", "p", null), false);
});

test("verifySignature: constant-time on length mismatch", () => {
  assert.equal(verifySignature("s", "p", "sha256=abc"), false);
});
