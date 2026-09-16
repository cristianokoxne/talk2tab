import assert from "node:assert/strict";
import test from "node:test";

const { ElementRegistry } = await import("../dist/agent/registry/elementRegistry.js");

test("creates ephemeral refs and invalidates the prior generation", () => {
  const registry = new ElementRegistry();
  const firstElement = {};
  const secondElement = {};

  registry.beginGeneration();
  const firstRef = registry.register(firstElement);
  assert.equal(firstRef, "el_1_1");
  assert.equal(registry.get(firstRef), firstElement);

  registry.beginGeneration();
  const secondRef = registry.register(secondElement);
  assert.equal(secondRef, "el_2_1");
  assert.equal(registry.has(firstRef), false);
  assert.equal(registry.get(secondRef), secondElement);
});
