import assert from "node:assert/strict";
import test from "node:test";

const { TabRunRegistry } = await import("../dist/agent/tabRunRegistry.js");

test("registry rejects a second session on the same tab and permits another tab", () => {
  const registry = new TabRunRegistry();
  const releaseFirst = registry.acquire(7, "request-a");
  assert.equal(typeof releaseFirst, "function");
  assert.equal(registry.acquire(7, "request-b"), undefined);
  assert.equal(registry.ownerOf(7), "request-a");
  const releaseOtherTab = registry.acquire(8, "request-c");
  assert.equal(typeof releaseOtherTab, "function");
  releaseOtherTab();
  assert.equal(registry.ownerOf(8), undefined);
});

test("registry release is idempotent and cannot clear a newer owner", () => {
  const registry = new TabRunRegistry();
  const release = registry.acquire(3, "old");
  release();
  const releaseNew = registry.acquire(3, "new");
  release();
  assert.equal(registry.ownerOf(3), "new");
  releaseNew();
  assert.equal(registry.ownerOf(3), undefined);
});
