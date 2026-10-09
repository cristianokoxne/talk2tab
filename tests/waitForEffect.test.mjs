import assert from "node:assert/strict";
import test from "node:test";

const { waitForPageEffect } = await import("../dist/agent/waitForEffect.js");
const page = { url: "https://fixture.test", title: "Fixture", viewport: { width: 1, height: 1, scrollY: 0 }, pageTextSummary: "", fingerprint: "before", elements: [], limitations: [] };

test("condition wait observes delayed page effects at 0, 100, 800 and 2500 ms", async () => {
  for (const delayMs of [0, 100, 800, 2500]) {
    const started = Date.now();
    const observed = await waitForPageEffect(async () => Date.now() - started >= delayMs
      ? { ...page, fingerprint: "after" }
      : page, page, undefined, { timeoutMs: 3_200, pollIntervalMs: 25, quietWindowMs: 75 });
    assert.equal(observed.fingerprint, "after", `effect after ${delayMs}ms`);
  }
});

test("continuously changing banner is bounded by the hard wait timeout", async () => {
  const started = Date.now();
  let revision = 0;
  const observed = await waitForPageEffect(async () => ({ ...page, fingerprint: `banner-${revision++}` }), page, undefined,
    { timeoutMs: 300, pollIntervalMs: 25, quietWindowMs: 75 });
  assert.ok(Date.now() - started < 700);
  assert.match(observed.fingerprint, /banner-/);
});

test("a transient observation error is retried a bounded number of times", async () => {
  let attempts = 0;
  const observed = await waitForPageEffect(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary inspection failure");
    return { ...page, fingerprint: "after" };
  }, page, undefined, { timeoutMs: 500, pollIntervalMs: 20, quietWindowMs: 50 });
  assert.equal(observed.fingerprint, "after");
  assert.ok(attempts >= 3);
});
