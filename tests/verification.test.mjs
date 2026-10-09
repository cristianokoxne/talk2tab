import assert from "node:assert/strict";
import test from "node:test";

const { verifyAction } = await import("../dist/agent/verification.js");

const page = {
  url: "https://example.test", title: "Example", viewport: { width: 800, height: 600, scrollY: 0 },
  pageTextSummary: "Same", fingerprint: "stable", elements: [], limitations: [],
};

test("dispatched click without an observed state change is not progress", () => {
  const result = verifyAction(page, page, { type: "click", target: { ref: "el_1_1" } }, { ok: true, dispatched: true, changed: false });
  assert.equal(result.ok, true);
  assert.equal(result.effectObserved, false);
  assert.equal(result.progressed, false);
  assert.deepEqual(result.evidence, []);
});

test("semantic state change proves an effect after a click", () => {
  const after = { ...page, fingerprint: "checkbox-checked" };
  const result = verifyAction(page, after, { type: "click", target: { ref: "el_1_1" } }, { ok: true, dispatched: true, changed: false });
  assert.equal(result.effectObserved, true);
  assert.equal(result.progressed, true);
  assert.ok(result.evidence.includes("semantic_page_state_changed"));
});

test("type progress is accepted only when the executor observed its value update", () => {
  const noEffect = verifyAction(page, page, { type: "type", target: { ref: "el_1_1" }, text: "query" }, { ok: true, changed: false });
  const observed = verifyAction(page, page, { type: "type", target: { ref: "el_1_1" }, text: "query" }, { ok: true, changed: true });
  assert.equal(noEffect.progressed, false);
  assert.equal(observed.progressed, true);
});
