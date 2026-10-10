import assert from "node:assert/strict";
import test from "node:test";

const { parseGoal } = await import("../dist/agent/intent.js");
const { buildJevCommandMap } = await import("../dist/agent/provider/commandMap.js");

const page = {
  url: "https://example.test/",
  title: "Example",
  viewport: { width: 1280, height: 800, scrollY: 0 },
  pageTextSummary: "",
  fingerprint: "youtube-test",
  limitations: [],
  elements: [{ ref: "el_1_1", frameId: 0, tag: "input", role: "searchbox", name: "Search", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 300, height: 30 } }],
  scrollContainers: [{ ref: "el_1_2", label: "Main content", scrollTop: 0, clientHeight: 800, scrollHeight: 2400, bounds: { x: 0, y: 0, width: 1200, height: 800 } }],
};

test("YouTube video request without a title asks for the missing topic instead of scrolling", () => {
  for (const goal of ["Entre em um vídeo no YouTube", "Procure um vídeo no YouTube", "Assista um vídeo do YouTube"]) {
    const plan = parseGoal(goal);
    assert.equal(plan.needsClarification, true, goal);
    assert.match(plan.clarification, /t[ií]tulo ou tema/i, goal);
    const { options } = buildJevCommandMap(goal, page);
    assert.equal(options.length, 1, goal);
    assert.equal(options[0].action.type, "finish", goal);
    assert.equal(options[0].action.status, "failed", goal);
    assert.match(options[0].action.message, /YouTube/i, goal);
  }
});

test("titled YouTube video request builds navigate, search and open-result stages", () => {
  const goal = "Entre no vídeo de Despacito no YouTube";
  const plan = parseGoal(goal);
  assert.deepEqual(plan.stages.map((stage) => stage.kind), ["navigate", "search", "open_result"]);
  assert.equal(plan.stages[1].value, "Despacito");

  const initial = buildJevCommandMap(goal, page);
  assert.deepEqual(initial.options.map((option) => option.action.type), ["navigate"]);

  const onYoutube = { ...page, url: "https://www.youtube.com/", title: "YouTube" };
  const search = buildJevCommandMap(goal, onYoutube, [], ["navigate"], 0, [{ type: "navigate", progressed: true }]);
  assert.deepEqual(search.options.map((option) => option.action.type), ["type"]);
  assert.equal(search.options[0].action.text, "Despacito");
});

test("YouTube video search does not use scrolling as a substitute for a missing search field", () => {
  const goal = "Entre no video de Despacito no YouTube";
  const noSearchField = { ...page, elements: [] };
  const { options } = buildJevCommandMap(goal, noSearchField, [], ["navigate"], 0, [{ type: "navigate", progressed: true }]);
  assert.equal(options.length, 1);
  assert.equal(options[0].action.type, "finish");
  assert.equal(options[0].action.status, "failed");
});

test("YouTube may scroll once to reveal lazy results, then must find a link or stop", () => {
  const goal = "Entre no video de Despacito no YouTube";
  const results = { ...page, url: "https://www.youtube.com/results?search_query=Despacito", pageTextSummary: "Despacito" };
  const searchHistory = [
    { type: "navigate", progressed: true },
    { type: "type", targetLabel: "Search", progressed: true },
    { type: "keypress", progressed: true },
  ];
  const firstObservation = buildJevCommandMap(goal, results, [], ["navigate", "type"], 0, searchHistory);
  assert.ok(firstObservation.options.some((option) => option.action.type === "scroll"));

  const afterScroll = buildJevCommandMap(goal, results, [], ["navigate", "type"], 0, [...searchHistory, { type: "scroll", progressed: true }]);
  assert.equal(afterScroll.options.length, 1);
  assert.equal(afterScroll.options[0].action.type, "finish");
  assert.equal(afterScroll.options[0].action.status, "failed");
});
