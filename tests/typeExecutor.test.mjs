import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { ElementRegistry } = await import("../dist/agent/registry/elementRegistry.js");
const { executeType } = await import("../dist/agent/executor/type.js");

test("type executor updates normal controls and blocks sensitive fields", () => {
  const dom = new JSDOM(`<input id="name" value="Old"><input id="password" type="password">`);
  const { document } = dom.window;
  Object.assign(globalThis, { HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement });
  const inputs = [...document.querySelectorAll("input")];
  for (const input of inputs) {
    input.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0, toJSON: () => ({}) });
    input.scrollIntoView = () => {};
    input.focus = () => {};
  }
  const registry = new ElementRegistry();
  registry.beginGeneration();
  const nameRef = registry.register(inputs[0]);
  const passwordRef = registry.register(inputs[1]);
  assert.equal(executeType("t1", registry, nameRef, "Cristiano").ok, true);
  assert.equal(inputs[0].value, "Cristiano");
  assert.equal(executeType("t2", registry, nameRef, " Koxne", false).ok, true);
  assert.equal(inputs[0].value, "Cristiano Koxne");
  assert.equal(executeType("t3", registry, passwordRef, "secret").code, "SENSITIVE_FIELD");
});
