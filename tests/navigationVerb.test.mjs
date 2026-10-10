import assert from "node:assert/strict";
import test from "node:test";

const { buildJevCommandMap } = await import("../dist/agent/provider/commandMap.js");
const { makeUninspectablePage } = await import("../dist/agent/navigation.js");

const tabs = [
  { id: 1, title: "Nova guia", url: "chrome://newtab/", active: true, windowId: 1 },
  { id: 2, title: "Docs", url: "https://docs.example/", active: false, windowId: 1 },
];

test("Portuguese enter-site commands navigate directly", () => {
  const state = makeUninspectablePage("chrome://newtab/", "Nova guia");
  const { map, options } = buildJevCommandMap("entre no Google", state, tabs);
  assert.equal(map.state.goalPlan.stages[0].kind, "navigate");
  assert.deepEqual(options.map((option) => option.action.type), ["navigate"]);
});

test("active tabs are omitted from switch_tab choices", () => {
  const state = makeUninspectablePage("chrome://newtab/", "Nova guia");
  const { map, options } = buildJevCommandMap("continue", state, tabs);
  assert.equal(options.some((option) => option.action.type === "switch_tab" && option.action.tabId === 1), false);
  assert.equal(options.some((option) => option.action.type === "switch_tab" && option.action.tabId === 2), true);
  assert.deepEqual(map.state.browser.tabs.map((tab) => tab.id), [2]);
});
