import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { ElementRegistry } = await import("../dist/agent/registry/elementRegistry.js");
const { executeClick } = await import("../dist/agent/executor/click.js");

test("click executor clicks only a connected visible registered ref", () => {
  const dom = new JSDOM(`<button id="go">Go</button><button id="disabled" disabled>Disabled</button>`);
  const button = dom.window.document.querySelector("#go");
  const disabled = dom.window.document.querySelector("#disabled");
  let clicks = 0;
  button.addEventListener("click", () => clicks += 1);
  Object.assign(globalThis, { HTMLButtonElement: dom.window.HTMLButtonElement });
  button.scrollIntoView = () => {};
  button.focus = () => {};
  disabled.scrollIntoView = () => {};
  disabled.focus = () => {};
  button.getBoundingClientRect = () => ({ x: 0, y: 0, width: 80, height: 30, top: 0, right: 80, bottom: 30, left: 0, toJSON: () => ({}) });
  disabled.getBoundingClientRect = button.getBoundingClientRect;
  const registry = new ElementRegistry();
  registry.beginGeneration();
  const ref = registry.register(button);
  const disabledRef = registry.register(disabled);
  assert.equal(executeClick("a1", registry, ref).ok, true);
  assert.equal(clicks, 1);
  assert.equal(executeClick("a2", registry, disabledRef).code, "ELEMENT_DISABLED");
  assert.equal(executeClick("a3", registry, "el_99_1").code, "STALE_ELEMENT");
});

test("click executor refuses aria-disabled, inert, and obscured controls", () => {
  const dom = new JSDOM(`<button id="disabled" aria-disabled="true">No</button><div inert><button id="inert">No</button></div><button id="covered">Go</button>`);
  Object.assign(globalThis, { HTMLButtonElement: dom.window.HTMLButtonElement });
  const registry = new ElementRegistry();
  registry.beginGeneration();
  const disabled = dom.window.document.querySelector("#disabled");
  const inert = dom.window.document.querySelector("#inert");
  const covered = dom.window.document.querySelector("#covered");
  for (const element of [disabled, inert, covered]) {
    element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 20, height: 20, top: 0, right: 20, bottom: 20, left: 0, toJSON: () => ({}) });
    element.scrollIntoView = () => {};
    element.focus = () => {};
  }
  dom.window.document.elementFromPoint = () => dom.window.document.body;
  assert.equal(executeClick("a4", registry, registry.register(disabled)).code, "ELEMENT_DISABLED");
  assert.equal(executeClick("a5", registry, registry.register(inert)).code, "ELEMENT_UNAVAILABLE");
  assert.equal(executeClick("a6", registry, registry.register(covered)).code, "CLICK_OBSCURED");
});
