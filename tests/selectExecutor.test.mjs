import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { ElementRegistry } = await import("../dist/agent/registry/elementRegistry.js");
const { executeSelect } = await import("../dist/agent/executor/select.js");

test("select executor chooses an option by value or visible label", () => {
  const dom = new JSDOM(`<select><option value="js">JavaScript</option><option value="ts">TypeScript</option></select>`);
  const select = dom.window.document.querySelector("select");
  Object.assign(globalThis, { HTMLSelectElement: dom.window.HTMLSelectElement });
  select.getBoundingClientRect = () => ({ x: 0, y: 0, width: 120, height: 30, top: 0, right: 120, bottom: 30, left: 0, toJSON: () => ({}) });
  select.scrollIntoView = () => {};
  select.focus = () => {};
  const registry = new ElementRegistry();
  registry.beginGeneration();
  const ref = registry.register(select);
  assert.equal(executeSelect("s1", registry, ref, "ts").ok, true);
  assert.equal(select.value, "ts");
  assert.equal(executeSelect("s2", registry, ref, "JavaScript").ok, true);
  assert.equal(select.value, "js");
  assert.equal(executeSelect("s3", registry, ref, "Rust").code, "OPTION_NOT_FOUND");
});
