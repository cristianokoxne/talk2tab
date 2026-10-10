import assert from "node:assert/strict";
import test from "node:test";

const { buildJevCommandMap } = await import("../dist/agent/provider/commandMap.js");
const { JevProvider } = await import("../dist/agent/provider/jev.js");
const { runAgentLoop } = await import("../dist/agent/loop.js");

test("scripted Jev drives a complete search journey without network access", async () => {
  const page = {
    url: "https://fixture.test/catalog", title: "Catalog",
    viewport: { width: 1280, height: 800, scrollY: 0 }, pageTextSummary: "Catalog search",
    fingerprint: "before", limitations: [], scrollContainers: [],
    elements: [
      { ref: "el_1_1", frameId: 0, tag: "input", role: "searchbox", name: "Pesquisar", type: "search", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 300, height: 30 } },
      { ref: "el_1_2", frameId: 0, tag: "button", role: "button", name: "Pesquisa Google", visible: true, enabled: true, bounds: { x: 0, y: 40, width: 120, height: 30 } },
    ],
  };
  const state = { page: structuredClone(page), query: "", submitted: false, calls: 0 };
  let currentOptions = [];
  const provider = new JevProvider({ id: "jev", endpoint: "https://scripted-jev.invalid/", apiKey: "test-only", model: "scripted" }, async (_url, request) => {
    state.calls += 1;
    const payload = JSON.parse(request.body);
    const choices = Object.keys(payload.questions.next_action.criteria);
    let selected = currentOptions.find((option) => option.action.type === "type")?.id;
    if (!selected && state.query && !state.submitted) selected = currentOptions.find((option) => option.action.type === "click")?.id;
    selected ??= currentOptions.find((option) => option.action.type === "finish")?.id;
    assert.ok(selected, "scripted provider must choose from the supplied closed action set");
    return { ok: true, status: 200, json: async () => ({ answers: { next_action: { choice: selected } } }) };
  });
  const goal = "pesquise sobre teclado sem fio";
  const result = await runAgentLoop({
    observe: async () => ({ ...state.page, fingerprint: `${state.query}:${state.submitted}` }),
    decide: async (observed, _signal, history = []) => {
      const { map, options } = buildJevCommandMap(goal, observed, [], history.map((entry) => entry.type), 0, history);
      currentOptions = options;
      return provider.chooseNextAction(map, options);
    },
    execute: async (action) => {
      state.completed ??= [];
      if (action.type === "type") state.query = action.text;
      if (action.type === "click") {
        state.submitted = true;
        state.page.url = `https://fixture.test/catalog?q=${encodeURIComponent(state.query)}`;
      }
      state.completed.push(action.type);
      return { ok: true, changed: true };
    },
    verify: (_before, _after, _action, actionResult) => ({ ok: actionResult.ok, progressed: actionResult.changed, reason: "Fixture state changed." }),
  }, 5);
  assert.equal(result.status, "success");
  assert.equal(state.query, "teclado sem fio");
  assert.equal(state.submitted, true);
  assert.equal(state.calls, 3);
});
