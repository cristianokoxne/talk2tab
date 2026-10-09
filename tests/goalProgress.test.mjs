import assert from "node:assert/strict";
import test from "node:test";

const { buildJevCommandMap } = await import("../dist/agent/provider/commandMap.js");

const page = {
  url: "https://fixture.test/settings", title: "Settings", viewport: { width: 900, height: 700, scrollY: 0 },
  pageTextSummary: "Settings", fingerprint: "same", limitations: [],
  elements: ["Menu conta", "Faturamento", "Faturas"].map((name, index) => ({
    ref: `el_1_${index + 1}`, frameId: 0, tag: "button", role: "button", name,
    visible: true, enabled: true, bounds: { x: 0, y: index * 40, width: 180, height: 30 },
  })),
};

test("menu, submenu and item goals expose one target at a time and only finish after all are observed", () => {
  const goal = "Abra “menu conta” e depois clique em “Faturamento” e clique em “Faturas”.";
  let history = [];
  const expected = ["Menu conta", "Faturamento", "Faturas"];
  for (let index = 0; index < expected.length; index += 1) {
    const { map, options } = buildJevCommandMap(goal, page, [], history.map((entry) => entry.type), 0, history);
    const clicks = options.filter((option) => option.action.type === "click");
    assert.equal(clicks.length, 1);
    assert.equal(page.elements.find((element) => element.ref === clicks[0].action.target.ref).name, expected[index]);
    if (index < expected.length - 1) assert.equal(options.some((option) => option.action.type === "finish" && option.action.status === "success"), false);
    history = [...history, { type: "click", targetLabel: expected[index], progressed: true, evidence: ["semantic_page_state_changed"] }];
    if (index === expected.length - 1) {
      const completed = buildJevCommandMap(goal, page, [], history.map((entry) => entry.type), 0, history);
      assert.deepEqual(completed.options.map((option) => option.action.type), ["finish"]);
      assert.ok(completed.map.state.goalPlan.stages.every((stage) => stage.status === "complete"));
    }
    void map;
  }
});
