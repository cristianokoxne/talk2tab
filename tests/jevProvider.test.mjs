import assert from "node:assert/strict";
import test from "node:test";

const { buildJevCommandMap } = await import("../dist/agent/provider/commandMap.js");
const { JevProvider } = await import("../dist/agent/provider/jev.js");

const page = {
  url: "https://example.com",
  title: "Example",
  viewport: { width: 1000, height: 800, scrollY: 0 },
  pageTextSummary: "Página de exemplo",
  fingerprint: "fp1",
  limitations: [],
  elements: [{ ref: "el_1_1", frameId: 0, tag: "button", role: "button", name: "Continuar", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 100, height: 30 } }],
};

test("Jev command map exposes only safe closed actions", () => {
  const { map, options } = buildJevCommandMap("continuar", page);
  assert.ok(options.some((option) => option.id === "click_el_1_1"));
  assert.ok(map.questions.next_action.criteria.click_el_1_1);
  assert.equal(map.questions.next_action.type, "choice");
});

test("Jev provider resolves a typed choice to the mapped action", async () => {
  const { map, options } = buildJevCommandMap("continuar", page);
  let request;
  const fakeFetch = async (_url, init) => {
    request = { _url, init };
    return { ok: true, status: 200, json: async () => ({ answers: { next_action: { choice: "click_el_1_1", confidence: 0.93, probabilities: { click_el_1_1: 0.93 } } } }) };
  };
  const decision = await new JevProvider({ id: "jev", endpoint: "https://jev.test/v1/systemone", apiKey: "secret", model: "jev-latest" }, fakeFetch).chooseNextAction(map, options);
  assert.equal(decision.action.type, "click");
  assert.equal(decision.confidence, 0.93);
  assert.equal(request.init.method, "POST");
  assert.match(request.init.headers.authorization, /secret/);
});

test("command map removes a completed open-window action from an open-only goal", () => {
  const { options, map } = buildJevCommandMap("abra o Google em uma nova janela", page, [], ["open_window"]);
  assert.deepEqual(options.map((option) => option.id), ["finish_success"]);
  assert.deepEqual(map.state.browser.completedActions, ["open_window"]);
});

test("command map extracts natural-language text for a textbox", () => {
  const inputPage = { ...page, elements: [{ ref: "el_1_2", frameId: 0, tag: "input", role: "textbox", name: "Busca", placeholder: "Pesquisar", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 100, height: 30 } }] };
  const { options } = buildJevCommandMap("digite alanzoka no campo de busca", inputPage);
  assert.deepEqual(options.find((option) => option.id === "type_el_1_2")?.action, { type: "type", target: { ref: "el_1_2" }, text: "alanzoka", replace: true });
});

test("command map treats accessible searchboxes as text inputs", () => {
  const searchPage = { ...page, elements: [{ ref: "el_1_3", frameId: 0, tag: "input", role: "searchbox", name: "Pesquisar", type: "search", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 300, height: 30 } }] };
  const { options } = buildJevCommandMap("pesquise sobre ultimo video do alanzoka", searchPage);
  assert.deepEqual(options.find((option) => option.id === "type_el_1_3")?.action, { type: "type", target: { ref: "el_1_3" }, text: "ultimo video do alanzoka", replace: true });
});

test("search phase prefers a visible search button after typing", () => {
  const searchPage = { ...page, elements: [
    { ref: "el_1_3", frameId: 0, tag: "input", role: "searchbox", name: "Pesquisar", type: "search", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 300, height: 30 } },
    { ref: "el_1_4", frameId: 0, tag: "button", role: "button", name: "Pesquisa Google", visible: true, enabled: true, bounds: { x: 0, y: 40, width: 120, height: 30 } },
  ] };
  const { options } = buildJevCommandMap("pesquise sobre bonoloto", searchPage, [], ["type"]);
  assert.deepEqual(options.map((option) => option.id), ["click_el_1_4"]);
});

test("compound search goals expose one deterministic phase at a time", () => {
  const inputPage = { ...page, elements: [{ ref: "el_1_2", frameId: 0, tag: "input", role: "textbox", name: "Busca", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 100, height: 30 } }] };
  const goal = "abra o Google e pesquise sobre cristiano koxne";
  assert.deepEqual(buildJevCommandMap(goal, inputPage).options.map((option) => option.id), ["navigate"]);
  assert.deepEqual(buildJevCommandMap(goal, inputPage, [], ["navigate"]).options.map((option) => option.id), ["type_el_1_2"]);
  assert.deepEqual(buildJevCommandMap(goal, inputPage, [], ["navigate", "type"]).options.map((option) => option.id), ["submit_search"]);
  assert.deepEqual(buildJevCommandMap(goal, inputPage, [], ["navigate", "type", "keypress"]).options.map((option) => option.id), ["finish_success"]);
});

test("search phase never sends an empty choice set when no textbox is visible", () => {
  const goal = "pesquise sobre cristiano koxne";
  const { options, map } = buildJevCommandMap(goal, page, [], []);
  assert.ok(options.length > 0);
  assert.ok(Object.keys(map.questions.next_action.criteria).length > 0);
});

test("generic destinations use web discovery when no URL is available", () => {
  const { options } = buildJevCommandMap("abra o git no repositorio do talk2tab", page);
  assert.deepEqual(options.map((option) => option.id), ["search_web"]);
  assert.equal(options[0].action.query, "talk2tab");
});
