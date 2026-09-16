import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { ElementRegistry } = await import("../dist/agent/registry/elementRegistry.js");
const { scanPage } = await import("../dist/agent/scanner/pageScanner.js");

test("collects visible interactive controls with accessible names and no sensitive values", () => {
  const dom = new JSDOM(`
    <title>Demo</title>
    <main>
      <label for="email">Email address</label>
      <input id="email" type="email" value="person@example.com">
      <input aria-label="Password" type="password" value="secret">
      <button>Continue</button>
      <a href="/support">Support</a>
      <button hidden>Hidden action</button>
    </main>
  `, { url: "https://example.test/login", pretendToBeVisual: true });
  const { document, window } = dom.window;
  Object.assign(globalThis, {
    HTMLAnchorElement: window.HTMLAnchorElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
  });
  Object.defineProperty(window, "innerWidth", { value: 1280 });
  Object.defineProperty(window, "innerHeight", { value: 720 });
  for (const element of document.querySelectorAll("input, button, a")) {
    element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 120, height: 30, top: 0, right: 120, bottom: 30, left: 0, toJSON: () => ({}) });
  }

  const state = scanPage(document, window, new ElementRegistry());
  assert.equal(state.title, "Demo");
  assert.equal(state.elements.length, 4);
  assert.deepEqual(state.elements.map((element) => element.ref), ["el_1_1", "el_1_2", "el_1_3", "el_1_4"]);
  assert.equal(state.elements[0].name, "Email address");
  assert.equal(state.elements[1].sensitive, true);
  assert.equal("value" in state.elements[1], false);
  assert.equal(state.elements[3].href, "https://example.test/support");
});
