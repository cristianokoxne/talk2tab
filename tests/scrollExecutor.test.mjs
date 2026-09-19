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
