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
  const click = options.find((option) => option.action.type === "click");
  assert.ok(click);
  assert.equal(click.id, "choice_001");
  assert.ok(map.questions.next_action.criteria[click.id]);
  assert.equal(map.questions.next_action.type, "choice");
});

test("command map exposes recognized menu items as click candidates", () => {
  const menuPage = { ...page, elements: [{ ref: "el_1_9", frameId: 0, tag: "div", role: "menuitem", name: "Account settings", visible: true, enabled: true, context: "navigation menu" }] };
  const { options } = buildJevCommandMap("continuar", menuPage);
  assert.ok(options.some((option) => option.action.type === "click"));
});

test("Jev provider resolves a typed choice to the mapped action", async () => {
  const { map, options } = buildJevCommandMap("continuar", page);
  let request;
  const fakeFetch = async (_url, init) => {
    request = { _url, init };
    const choice = Object.entries(JSON.parse(request.init.body).questions.next_action.criteria)
      .find(([, criterion]) => criterion.description.includes("Continuar"))?.[0];
    return { ok: true, status: 200, json: async () => ({ model: "jev-test-2026", answers: { next_action: { type: "choice", choice, confidence: 0.93, probabilities: { [choice]: 0.93 } } } }) };
  };
  const decision = await new JevProvider({ id: "jev", endpoint: "https://jev.test/v1/systemone", apiKey: "secret", model: "jev-latest" }, fakeFetch).chooseNextAction(map, options);
  assert.equal(decision.action.type, "click");
  assert.equal(decision.confidence, 0.93);
  assert.equal(decision.model, "jev-test-2026");
  assert.equal(request.init.method, "POST");
  assert.match(request.init.headers.authorization, /secret/);
});

test("Jev provider tolerates omitted optional confidence and probabilities", async () => {
  const { map, options } = buildJevCommandMap("continuar", page);
  const selected = options[0];
  const provider = new JevProvider({ id: "jev", apiKey: "test" }, async () => ({
    ok: true, status: 200, json: async () => ({ answers: { next_action: { choice: selected.id } } }),
  }));
  const decision = await provider.chooseNextAction(map, options);
  assert.equal(decision.optionId, selected.id);
  assert.deepEqual(decision.probabilities, {});
  assert.equal(decision.confidence, undefined);
});

test("Jev provider rejects malformed and unknown probability outputs before execution", async () => {
  const { map, options } = buildJevCommandMap("continuar", page);
  for (const probabilities of [{ unknown_choice: 1 }, { choice_001: 1.2 }]) {
    const provider = new JevProvider({ id: "jev", apiKey: "test" }, async () => ({
      ok: true, status: 200, json: async () => ({ answers: { next_action: { choice: options[0].id, probabilities } } }),
    }));
    const error = await provider.chooseNextAction(map, options).then(() => { throw new Error("Expected invalid response."); }, (caught) => caught);
    assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
  }
  const unknownProvider = new JevProvider({ id: "jev", apiKey: "test" }, async () => ({
    ok: true, status: 200, json: async () => ({ answers: { next_action: { choice: "unmapped" } } }),
  }));
  const unknown = await unknownProvider.chooseNextAction(map, options).then(() => { throw new Error("Expected unknown choice."); }, (caught) => caught);
  assert.equal(unknown.code, "PROVIDER_UNKNOWN_CHOICE");
});

test("Jev provider abort signal cancels an in-flight request", async () => {
  const { map, options } = buildJevCommandMap("continuar", page);
  const controller = new AbortController();
  let receivedSignal;
  const fakeFetch = async (_url, init) => {
    receivedSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  };
  const pending = new JevProvider({ id: "jev", apiKey: "test" }, fakeFetch).chooseNextAction(map, options, controller.signal);
  controller.abort();
  const error = await pending.then(() => { throw new Error("Expected provider request to abort."); }, (caught) => caught);
  assert.match(error.message, /cancelled/i);
  assert.equal(error.code, "PROVIDER_CANCELLED");
  assert.equal(receivedSignal.aborted, true);
});

test("Jev provider times out a stalled response and aborts its fetch", async () => {
  const { map, options } = buildJevCommandMap("continuar", page);
  let receivedSignal;
  const fakeFetch = async (_url, init) => {
    receivedSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  };
  const pending = new JevProvider({ id: "jev", apiKey: "test", timeoutMs: 1000 }, fakeFetch).chooseNextAction(map, options);
  const error = await pending.then(() => { throw new Error("Expected provider request to time out."); }, (caught) => caught);
  assert.match(error.message, /timed out after 1000ms/);
  assert.equal(error.code, "PROVIDER_TIMEOUT");
  assert.equal(receivedSignal.aborted, true);
});

test("Jev provider preserves HTTP failures as a distinct error code", async () => {
  const { map, options } = buildJevCommandMap("continuar", page);
  const error = await new JevProvider({ id: "jev", apiKey: "test" }, async () => ({
    ok: false, status: 429, text: async () => "rate limited",
  })).chooseNextAction(map, options).then(() => { throw new Error("Expected HTTP failure."); }, (caught) => caught);
  assert.equal(error.code, "PROVIDER_HTTP_ERROR");
  assert.match(error.message, /429/);
});

test("command map removes a completed open-window action from an open-only goal", () => {
  const { options, map } = buildJevCommandMap("abra o Google em uma nova janela", page, [], ["open_window"]);
  assert.equal(options.length, 1);
  assert.equal(options[0].action.type, "finish");
  assert.deepEqual(map.state.browser.completedActions, ["open_window"]);
});

test("command map extracts natural-language text for a textbox", () => {
  const inputPage = { ...page, elements: [{ ref: "el_1_2", frameId: 0, tag: "input", role: "textbox", name: "Busca", placeholder: "Pesquisar", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 100, height: 30 } }] };
  const { options } = buildJevCommandMap("digite alanzoka no campo de busca", inputPage);
  assert.deepEqual(options.find((option) => option.action.type === "type")?.action, { type: "type", target: { ref: "el_1_2" }, text: "alanzoka", replace: true });
});

test("command map treats accessible searchboxes as text inputs", () => {
  const searchPage = { ...page, elements: [{ ref: "el_1_3", frameId: 0, tag: "input", role: "searchbox", name: "Pesquisar", type: "search", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 300, height: 30 } }] };
  const { options } = buildJevCommandMap("pesquise sobre ultimo video do alanzoka", searchPage);
  assert.deepEqual(options.find((option) => option.action.type === "type")?.action, { type: "type", target: { ref: "el_1_3" }, text: "ultimo video do alanzoka", replace: true });
});

test("search phase prefers a visible search button after typing", () => {
  const searchPage = { ...page, elements: [
    { ref: "el_1_3", frameId: 0, tag: "input", role: "searchbox", name: "Pesquisar", type: "search", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 300, height: 30 } },
    { ref: "el_1_4", frameId: 0, tag: "button", role: "button", name: "Pesquisa Google", visible: true, enabled: true, bounds: { x: 0, y: 40, width: 120, height: 30 } },
  ] };
  const { options } = buildJevCommandMap("pesquise sobre bonoloto", searchPage, [], ["type"]);
  assert.deepEqual(options.map((option) => option.action.type), ["click"]);
});

test("compound search goals expose one deterministic phase at a time", () => {
  const inputPage = { ...page, elements: [{ ref: "el_1_2", frameId: 0, tag: "input", role: "textbox", name: "Busca", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 100, height: 30 } }] };
  const goal = "abra o Google e pesquise sobre cristiano koxne";
  const typedHistory = [{ type: "type", targetLabel: "Busca", dispatched: true, progressed: true }];
  const unsubmittedHistory = [...typedHistory, { type: "keypress", dispatched: true, progressed: false }];
  assert.deepEqual(buildJevCommandMap(goal, inputPage).options.map((option) => option.action.type), ["navigate"]);
  assert.deepEqual(buildJevCommandMap(goal, inputPage, [], ["navigate"]).options.map((option) => option.action.type), ["type"]);
  assert.deepEqual(buildJevCommandMap(goal, inputPage, [], ["navigate", "type"], 0, typedHistory).options.map((option) => option.action.type), ["keypress"]);
  const afterUnobservedEnter = buildJevCommandMap(goal, inputPage, [], ["navigate", "type", "keypress"], 0, unsubmittedHistory).options;
  assert.equal(afterUnobservedEnter[0].action.type, "finish");
  assert.equal(afterUnobservedEnter[0].action.status, "failed");
});

test("unrelated click does not count as a submitted search", () => {
  const searchPage = { ...page, elements: [
    { ref: "el_1_3", frameId: 0, tag: "input", role: "searchbox", name: "Search", type: "search", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 300, height: 30 } },
    { ref: "el_1_4", frameId: 0, tag: "button", role: "button", name: "Suggested topic", visible: true, enabled: true, bounds: { x: 0, y: 40, width: 120, height: 30 } },
  ] };
  const history = [
    { type: "type", targetLabel: "Search", dispatched: true, progressed: true },
    { type: "click", targetLabel: "Suggested topic", targetRole: "button", dispatched: true, progressed: true },
  ];
  const { options } = buildJevCommandMap('search for "accessibility"', searchPage, [], ["type", "click"], 0, history);
  assert.deepEqual(options.map((option) => option.action.type), ["keypress"]);
});

test("a search control click without observed query falls back to Enter instead of retrying the same click", () => {
  const searchPage = { ...page, elements: [
    { ref: "el_1_3", frameId: 0, tag: "input", role: "searchbox", name: "Search", type: "search", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 300, height: 30 } },
    { ref: "el_1_4", frameId: 0, tag: "button", role: "button", name: "Search", visible: true, enabled: true, bounds: { x: 0, y: 40, width: 120, height: 30 } },
  ] };
  const history = [
    { type: "type", targetLabel: "Search", dispatched: true, progressed: true },
    { type: "click", targetLabel: "Search", targetRole: "button", dispatched: true, progressed: false },
  ];
  const { options } = buildJevCommandMap('search for "accessibility"', searchPage, [], ["type", "click"], 0, history);
  assert.deepEqual(options.map((option) => option.action.type), ["keypress"]);
});

test("observed query in URL completes search only after it is present", () => {
  const searchResultsPage = { ...page, url: "https://example.com/search?q=accessibility" };
  const { options } = buildJevCommandMap('search for "accessibility"', searchResultsPage);
  assert.deepEqual(options.map((option) => option.action.type), ["finish"]);
  assert.equal(options[0].action.status, "success");
});

test("observed result text can confirm an AJAX search after a successful submit", () => {
  const searchResultsPage = { ...page, pageTextSummary: "Results for accessibility: Accessible name guide" };
  const history = [
    { type: "type", targetLabel: "Search", dispatched: true, progressed: true },
    { type: "keypress", dispatched: true, progressed: true },
  ];
  const { options } = buildJevCommandMap('search for "accessibility"', searchResultsPage, [], ["type", "keypress"], 0, history);
  assert.deepEqual(options.map((option) => option.action.type), ["finish"]);
  assert.equal(options[0].action.status, "success");
});

test("search phase never sends an empty choice set when no textbox is visible", () => {
  const goal = "pesquise sobre cristiano koxne";
  const { options, map } = buildJevCommandMap(goal, page, [], []);
  assert.ok(options.length > 0);
  assert.ok(Object.keys(map.questions.next_action.criteria).length > 0);
});

test("generic destinations use web discovery when no URL is available", () => {
  const { options } = buildJevCommandMap("abra o git no repositorio do talk2tab", page);
  assert.deepEqual(options.map((option) => option.action.type), ["search_web"]);
  assert.equal(options[0].action.query, "talk2tab");
});
