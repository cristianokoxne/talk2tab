import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { ElementRegistry } = await import("../dist/agent/registry/elementRegistry.js");
const { executeSelect } = await import("../dist/agent/executor/select.js");

test("select executor chooses an option by value or visible label", async () => {
  const dom = new JSDOM(`<select><option value="js">JavaScript</option><option value="ts">TypeScript</option></select>`);
  const select = dom.window.document.querySelector("select");
  Object.assign(globalThis, { HTMLSelectElement: dom.window.HTMLSelectElement });
  select.getBoundingClientRect = () => ({ x: 0, y: 0, width: 120, height: 30, top: 0, right: 120, bottom: 30, left: 0, toJSON: () => ({}) });
  select.scrollIntoView = () => {};
  select.focus = () => {};
  const registry = new ElementRegistry();
  registry.beginGeneration();
  const ref = registry.register(select);
  assert.equal((await executeSelect("s1", registry, ref, "ts")).ok, true);
  assert.equal(select.value, "ts");
  assert.equal((await executeSelect("s2", registry, ref, "JavaScript")).ok, true);
  assert.equal(select.value, "js");
  assert.equal((await executeSelect("s3", registry, ref, "Rust")).code, "OPTION_NOT_FOUND");
});

test("select executor disambiguates optgroups and refuses duplicate or disabled options", async () => {
  const dom = new JSDOM(`<select><optgroup label="United States"><option value="en-us">English</option></optgroup><optgroup label="United Kingdom"><option value="en-gb">English</option><option value="blocked" disabled>Unavailable</option></optgroup><optgroup label="Disabled" disabled><option value="disabled">Unavailable group</option></optgroup></select>`);
  const select = dom.window.document.querySelector("select");
  Object.assign(globalThis, { HTMLSelectElement: dom.window.HTMLSelectElement });
  select.getBoundingClientRect = () => ({ x: 0, y: 0, width: 120, height: 30, top: 0, right: 120, bottom: 30, left: 0, toJSON: () => ({}) });
  select.scrollIntoView = () => {};
  const registry = new ElementRegistry(); registry.beginGeneration();
  const ref = registry.register(select);
  assert.equal((await executeSelect("s4", registry, ref, "English")).code, "AMBIGUOUS_OPTION");
  const chosen = await executeSelect("s5", registry, ref, "United Kingdom > English");
  assert.equal(chosen.ok, true);
  assert.equal(chosen.selectionLabel, "United Kingdom › English");
  assert.equal(select.value, "en-gb");
  assert.equal((await executeSelect("s6", registry, ref, "blocked")).code, "OPTION_NOT_FOUND");
  assert.equal((await executeSelect("s7", registry, ref, "Unavailable group")).code, "OPTION_NOT_FOUND");
});

test("multi-select requires an explicit value list instead of silently replacing selection", async () => {
  const dom = new JSDOM(`<select multiple><option value="a">A</option><option value="b">B</option></select>`);
  const select = dom.window.document.querySelector("select");
  Object.assign(globalThis, { HTMLSelectElement: dom.window.HTMLSelectElement });
  select.getBoundingClientRect = () => ({ x: 0, y: 0, width: 120, height: 30, top: 0, right: 120, bottom: 30, left: 0, toJSON: () => ({}) });
  const registry = new ElementRegistry(); registry.beginGeneration();
  assert.equal((await executeSelect("s8", registry, registry.register(select), "a")).code, "MULTIPLE_VALUES_REQUIRED");
});

test("select executor detects a controlled re-render that restores the prior option", async () => {
  const dom = new JSDOM(`<select><option value="a">A</option><option value="b">B</option></select>`);
  const select = dom.window.document.querySelector("select");
  Object.assign(globalThis, { HTMLSelectElement: dom.window.HTMLSelectElement });
  select.value = "a";
  select.getBoundingClientRect = () => ({ x: 0, y: 0, width: 120, height: 30, top: 0, right: 120, bottom: 30, left: 0, toJSON: () => ({}) });
  select.scrollIntoView = () => {};
  select.addEventListener("change", () => setTimeout(() => { select.value = "a"; }, 60));
  const registry = new ElementRegistry(); registry.beginGeneration();
  const result = await executeSelect("s9", registry, registry.register(select), "b");
  assert.equal(result.code, "SELECTION_REVERTED");
  assert.equal(select.value, "a");
});
