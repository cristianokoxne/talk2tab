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
  assert.equal("value" in state.elements[0], false);
  assert.equal(state.elements[1].sensitive, true);
  assert.equal("value" in state.elements[1], false);
  assert.equal(state.elements[3].href, "https://example.test/support");
});

test("scans interactive controls inside open shadow roots", () => {
  const dom = new JSDOM(`<main><search-widget></search-widget></main>`, { url: "https://youtube.com", pretendToBeVisual: true });
  const host = dom.window.document.querySelector("search-widget");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<input id="search" type="search" placeholder="Pesquisar">`;
  const input = shadow.querySelector("input");
  input.getBoundingClientRect = () => ({ x: 10, y: 10, width: 300, height: 30, top: 10, right: 310, bottom: 40, left: 10, toJSON: () => ({}) });
  Object.assign(globalThis, { HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLSelectElement: dom.window.HTMLSelectElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLAnchorElement: dom.window.HTMLAnchorElement });
  Object.defineProperty(dom.window, "innerWidth", { value: 1280 });
  Object.defineProperty(dom.window, "innerHeight", { value: 720 });
  const state = scanPage(dom.window.document, dom.window, new ElementRegistry());
  assert.equal(state.elements.length, 1);
  assert.equal(state.elements[0].role, "searchbox");
  assert.equal(state.elements[0].placeholder, "Pesquisar");
});

test("scanner identifies horizontal scroll areas and records measured offsets", () => {
  const dom = new JSDOM(`<main><div id="table" aria-label="Tabela de preços" style="overflow-x:auto;width:100px"><table><tr><td>wide content</td></tr></table></div></main>`, { url: "https://example.test", pretendToBeVisual: true });
  const { document, window } = dom.window;
  Object.defineProperties(window, { innerWidth: { value: 800 }, innerHeight: { value: 600 }, scrollX: { value: 12 } });
  const table = document.querySelector("#table");
  Object.defineProperties(table, { clientWidth: { value: 100 }, scrollWidth: { value: 500 }, clientHeight: { value: 80 }, scrollHeight: { value: 80 }, scrollLeft: { value: 30 } });
  table.getBoundingClientRect = () => ({ x: 10, y: 10, width: 100, height: 80, top: 10, right: 110, bottom: 90, left: 10, toJSON: () => ({}) });
  const state = scanPage(document, window, new ElementRegistry());
  assert.equal(state.viewport.scrollX, 12);
  assert.equal(state.scrollContainers?.[0].label, "Tabela de preços");
  assert.equal(state.scrollContainers?.[0].scrollLeft, 30);
  assert.equal(state.scrollContainers?.[0].scrollWidth, 500);
  assert.equal(state.scrollContainers?.[0].clientWidth, 100);
});

test("semantic fingerprint ignores fresh refs and debug overlay but tracks checkbox state", () => {
  const dom = new JSDOM(`<main><label><input id="available" type="checkbox"> Available</label></main>`, { url: "https://example.test/items", pretendToBeVisual: true });
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
  const checkbox = document.querySelector("input");
  checkbox.getBoundingClientRect = () => ({ x: 0, y: 0, width: 120, height: 30, top: 0, right: 120, bottom: 30, left: 0, toJSON: () => ({}) });
  const registry = new ElementRegistry();
  const fingerprints = Array.from({ length: 10 }, () => scanPage(document, window, registry).fingerprint);
  assert.equal(new Set(fingerprints).size, 1);

  const overlay = document.createElement("div");
  overlay.id = "voice-browser-agent-debug-overlay";
  overlay.textContent = "ephemeral-debug-ref";
  document.body.append(overlay);
  assert.equal(scanPage(document, window, registry).fingerprint, fingerprints[0]);

  checkbox.checked = true;
  assert.notEqual(scanPage(document, window, registry).fingerprint, fingerprints[0]);
});

test("scanner exposes field relationships, form context, validation and dialog state", () => {
  const dom = new JSDOM(`
    <main><form aria-label="Contact information">
      <label for="email">Email address</label>
      <span id="email-error">Enter a valid email</span>
      <input id="email" type="email" required aria-invalid="true" aria-describedby="email-error">
      <button aria-disabled="true">Continue</button>
    </form>
    <dialog open aria-label="Preferences"><button id="close">Close</button></dialog></main>
  `, { url: "https://example.test/profile", pretendToBeVisual: true });
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
  for (const element of document.querySelectorAll("main, form, dialog, input, button")) {
    element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 300, height: 80, top: 0, right: 300, bottom: 80, left: 0, toJSON: () => ({}) });
  }
  document.querySelector("input").focus();
  const state = scanPage(document, window, new ElementRegistry());
  const email = state.elements.find((element) => element.name === "Email address");
  const disabled = state.elements.find((element) => element.name === "Continue");
  assert.equal(email.required, true);
  assert.equal(email.invalid, true);
  assert.equal(email.description, "Enter a valid email");
  assert.match(email.context, /form.*Contact information/);
  assert.equal(disabled.enabled, false);
  assert.equal(state.activeDialog, "Preferences");
  assert.equal(state.focusedElement, email.ref);
  assert.ok(state.regions.some((region) => region.kind === "dialog" && region.name === "Preferences"));
});

test("accessible labels and descriptions resolve inside an open shadow root", () => {
  const dom = new JSDOM(`<search-widget></search-widget>`, { url: "https://example.test", pretendToBeVisual: true });
  const host = dom.window.document.querySelector("search-widget");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<span id="label">Internal search</span><span id="help">Search products</span><input aria-labelledby="label" aria-describedby="help">`;
  const input = shadow.querySelector("input");
  input.getBoundingClientRect = () => ({ x: 0, y: 0, width: 200, height: 30, top: 0, right: 200, bottom: 30, left: 0, toJSON: () => ({}) });
  const { document, window } = dom.window;
  Object.assign(globalThis, { HTMLAnchorElement: window.HTMLAnchorElement, HTMLButtonElement: window.HTMLButtonElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  Object.defineProperty(window, "innerWidth", { value: 1280 });
  Object.defineProperty(window, "innerHeight", { value: 720 });
  const state = scanPage(document, window, new ElementRegistry());
  assert.equal(state.elements[0].name, "Internal search");
  assert.equal(state.elements[0].description, "Search products");
});

test("scanner excludes controls inside aria-hidden and inert ancestors", () => {
  const dom = new JSDOM(`<main><div aria-hidden="true"><button>Hidden</button></div><div inert><button>Inert</button></div><button>Available</button></main>`, { url: "https://example.test", pretendToBeVisual: true });
  const { document, window } = dom.window;
  Object.assign(globalThis, { HTMLAnchorElement: window.HTMLAnchorElement, HTMLButtonElement: window.HTMLButtonElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLTextAreaElement: window.HTMLTextAreaElement });
  Object.defineProperty(window, "innerWidth", { value: 1280 });
  Object.defineProperty(window, "innerHeight", { value: 720 });
  for (const button of document.querySelectorAll("button")) button.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 30, top: 0, right: 100, bottom: 30, left: 0, toJSON: () => ({}) });
  const state = scanPage(document, window, new ElementRegistry());
  assert.deepEqual(state.elements.map((element) => element.name), ["Available"]);
});
