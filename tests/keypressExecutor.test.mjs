import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { executeKeyPress } = await import("../dist/agent/executor/keypress.js");

test("keypress executor dispatches allowed keys and rejects arbitrary names", () => {
  const dom = new JSDOM(`<input>`);
  const input = dom.window.document.querySelector("input");
  input.focus();
  const seen = [];
  input.addEventListener("keydown", (event) => seen.push(event.key));
  assert.equal(executeKeyPress("k1", dom.window.document, "ENTER").ok, true);
  assert.deepEqual(seen, ["Enter"]);
  assert.equal(executeKeyPress("k2", dom.window.document, "launch-shell").code, "UNSUPPORTED_KEY");
});
