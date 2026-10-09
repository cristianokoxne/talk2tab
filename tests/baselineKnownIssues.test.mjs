import assert from "node:assert/strict";
import test from "node:test";

const { buildJevCommandMap } = await import("../dist/agent/provider/commandMap.js");
const { runAgentLoop } = await import("../dist/agent/loop.js");
const { executeScroll } = await import("../dist/agent/executor/scroll.js");

const page = {
  url: "https://fixture.test/search", title: "Search results",
  viewport: { width: 1280, height: 800, scrollY: 0 }, pageTextSummary: "Results",
  fingerprint: "stable-test-state", limitations: [], scrollContainers: [],
  elements: [
    { ref: "el_1_1", frameId: 0, tag: "button", role: "button", name: "Open search", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 120, height: 30 } },
    { ref: "el_1_2", frameId: 0, tag: "a", role: "link", name: "First organic result", href: "https://fixture.test/result", visible: true, enabled: true, bounds: { x: 0, y: 50, width: 200, height: 30 } },
  ],
};

test("baseline: compound search is marked complete before opening its result", () => {
  const { options } = buildJevCommandMap("pesquise por teclado e abra o primeiro resultado", page, [], ["navigate", "type", "keypress"]);
  assert.deepEqual(options.map(({ id }) => id), ["finish_success"]);
});

test("baseline: hidden search has no reveal action in the restricted candidate set", () => {
  const hiddenSearchPage = { ...page, elements: [page.elements[0], page.elements[1]] };
  const { options } = buildJevCommandMap("pesquise por teclado", hiddenSearchPage);
  assert.equal(options.some((option) => option.action.type === "click" && option.action.target.ref === "el_1_1"), false);
  assert.ok(options.every((option) => option.action.type === "scroll" || option.action.type === "finish"), "Known baseline currently falls back to scroll/finish");
});

test("late provider decision after cancellation does not dispatch an action", async () => {
  const controller = new AbortController();
  let resolveDecision;
  let dispatched = false;
  const run = runAgentLoop({
    observe: async () => page,
    decide: () => new Promise((resolve) => { resolveDecision = resolve; }),
    execute: async () => { dispatched = true; return { ok: true, changed: true }; },
  }, 2, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  resolveDecision({ optionId: "click_result", action: { type: "click", target: { ref: "el_1_2" } }, probabilities: {} });
  await run;
  assert.equal(dispatched, false, "A provider result arriving after cancellation must be discarded");
  assert.equal((await run).status, "cancelled");
});

test("scroll boundary reports no movement", () => {
  const panel = { scrollTop: 100, scrollHeight: 200, clientHeight: 100 };
  const result = executeScroll("scroll-at-end", { innerHeight: 800 }, { type: "scroll", direction: "down", amount: 60 }, panel);
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
});
