import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { ElementRegistry } = await import("../dist/agent/registry/elementRegistry.js");
const { showDebugOverlay, removeDebugOverlay } = await import("../dist/agent/overlay/debugOverlay.js");

test("debug overlay renders interactive refs and scroll-container refs", () => {
  const dom = new JSDOM("<button>Open</button><main id='scroller'>content</main>");
  const { document } = dom.window;
  const registry = new ElementRegistry("overlay");
  const button = document.querySelector("button");
  const scroller = document.querySelector("main");
  const buttonRef = registry.register(button);
  const scrollRef = registry.register(scroller);

  showDebugOverlay(document, registry, [{ ref: buttonRef }], [{ ref: scrollRef }]);
  const markers = [...document.querySelectorAll("#voice-browser-agent-debug-overlay [data-ref]")];
  assert.deepEqual(markers.map((marker) => [marker.dataset.ref, marker.dataset.kind]), [
    [buttonRef, "element"],
    [scrollRef, "scroll"],
  ]);
  assert.equal(document.querySelector("#voice-browser-agent-debug-overlay").getAttribute("aria-hidden"), "true");

  showDebugOverlay(document, registry, [], [{ ref: scrollRef }]);
  assert.equal(document.querySelectorAll("#voice-browser-agent-debug-overlay [data-ref]").length, 1);
  removeDebugOverlay(document);
  assert.equal(document.querySelector("#voice-browser-agent-debug-overlay"), null);
});
