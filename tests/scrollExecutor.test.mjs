import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { executeScroll } = await import("../dist/agent/executor/scroll.js");

test("scroll executor applies bounded viewport and pixel deltas", () => {
  const dom = new JSDOM("<body></body>", { pretendToBeVisual: true });
  const calls = [];
  Object.defineProperty(dom.window, "innerHeight", { value: 1000 });
  dom.window.scrollBy = (options) => calls.push(options);
  assert.equal(executeScroll("s1", dom.window, { type: "scroll", direction: "down", amount: "viewport" }).ok, true);
  assert.equal(calls[0].top, 800);
  assert.equal(executeScroll("s2", dom.window, { type: "scroll", direction: "up", amount: 120 }).ok, true);
  assert.equal(calls[1].top, -120);
  assert.equal(executeScroll("s3", dom.window, { type: "scroll", direction: "down", amount: 20001 }).code, "INVALID_SCROLL_AMOUNT");
});

test("scroll executor uses target dimensions and supports horizontal and endpoint movement", () => {
  const dom = new JSDOM(`<div id="panel"></div>`, { pretendToBeVisual: true });
  const panel = dom.window.document.querySelector("#panel");
  Object.defineProperties(panel, {
    clientHeight: { value: 100 }, scrollHeight: { value: 500, configurable: true },
    clientWidth: { value: 200 }, scrollWidth: { value: 800, configurable: true },
  });
  assert.equal(executeScroll("s4", dom.window, { type: "scroll", direction: "down", amount: "viewport" }, panel).changed, true);
  assert.equal(panel.scrollTop, 80, "Viewport steps use the selected panel height");
  assert.equal(executeScroll("s5", dom.window, { type: "scroll", direction: "right", amount: "viewport" }, panel).changed, true);
  assert.equal(panel.scrollLeft, 160, "Horizontal steps use the selected panel width");
  assert.equal(executeScroll("s6", dom.window, { type: "scroll", direction: "bottom", amount: "viewport" }, panel).changed, true);
  assert.equal(panel.scrollTop, 400);
  assert.equal(executeScroll("s7", dom.window, { type: "scroll", direction: "top", amount: "viewport" }, panel).changed, true);
  assert.equal(panel.scrollTop, 0);
});
