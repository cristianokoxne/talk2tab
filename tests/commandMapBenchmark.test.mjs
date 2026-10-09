import assert from "node:assert/strict";
import test from "node:test";

const { buildJevCommandMap } = await import("../dist/agent/provider/commandMap.js");

function pageWithTarget(targetIndex, count = 160) {
  const elements = Array.from({ length: count }, (_, index) => ({
    ref: `el_1_${index + 1}`,
    frameId: 0,
    tag: "button",
    role: "button",
    name: index === targetIndex ? `Open Special destination ${targetIndex}` : `Generic control ${index}`,
    text: index === targetIndex ? `Open Special destination ${targetIndex}` : undefined,
    context: index % 3 === 0 ? `card item ${index}` : "main content",
    visible: true,
    enabled: true,
    bounds: { x: 0, y: index * 30, width: 120, height: 30 },
  }));
  return {
    url: "https://fixture.test/catalog", title: "Catalog", viewport: { width: 1280, height: 800, scrollY: 0 },
    pageTextSummary: "Catalog page", fingerprint: "fixture", elements, limitations: [],
    regions: [{ kind: "main", name: "Catalog", text: "A deterministic fixture" }], scrollContainers: [],
  };
}

test("candidate ranking retains the relevant target across 100 supported synthetic states", () => {
  let recalled = 0;
  for (let index = 0; index < 100; index += 1) {
    const targetIndex = (index * 37) % 160;
    const { options } = buildJevCommandMap(`open Special destination ${targetIndex}`, pageWithTarget(targetIndex));
    if (options.some((option) => option.action.type === "click" && option.action.target.ref === `el_1_${targetIndex + 1}`)) recalled += 1;
  }
  assert.equal(recalled / 100, 1);
});

test("large pages stay within the option and payload budgets and report omitted context", () => {
  const large = pageWithTarget(900, 1000);
  const { map, options } = buildJevCommandMap("open Special destination 900", large);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(map)).length;
  assert.ok(options.length <= 60);
  assert.ok(payloadBytes <= 64 * 1024);
  assert.equal(map.state.browser.coverage.truncated, true);
  assert.ok(map.state.browser.coverage.omittedCandidates > 0);
  assert.ok(map.state.browser.coverage.omittedCandidates > 0);
  assert.equal(map.state.browser.coverage.payloadBytes <= 64 * 1024, true);
  assert.ok(options.some((option) => option.action.type === "click" && option.action.target.ref === "el_1_901"));
});

test("candidate pagination exposes later controls through a non-site expansion action", () => {
  const page = pageWithTarget(-1, 140);
  const first = buildJevCommandMap("continue", page);
  const expand = first.options.find((option) => option.action.type === "expand_candidates");
  assert.ok(expand);
  assert.equal(first.options.some((option) => option.action.type === "click" && option.action.target.ref === "el_1_100"), false);
  assert.equal(expand.action.nextOffset, 59);
  const second = buildJevCommandMap("continue", page, [], [], expand.action.nextOffset);
  assert.ok(second.options.some((option) => option.action.type === "click" && option.action.target.ref === "el_1_100"));
});

test("select values stay local while Jev receives a distinct human-readable option", () => {
  const sensitiveValue = "account-token-7b9d";
  const page = {
    url: "https://fixture.test/form", title: "Form", viewport: { width: 800, height: 600, scrollY: 0 },
    pageTextSummary: "Choose a plan", fingerprint: "form", limitations: [], scrollContainers: [],
    elements: [{ ref: "el_1_1", frameId: 0, tag: "select", role: "combobox", name: "Plan", context: "form “Subscription”", visible: true, enabled: true, options: [{ value: sensitiveValue, label: "Premium annual" }], bounds: { x: 0, y: 0, width: 200, height: 30 } }],
  };
  const { map, options } = buildJevCommandMap("choose Premium annual", page);
  const choice = options.find((option) => option.action.type === "select");
  assert.equal(choice.action.value, sensitiveValue, "The executor retains the original value locally");
  assert.match(map.questions.next_action.criteria[choice.id].description, /Premium annual/);
  assert.equal(JSON.stringify(map).includes(sensitiveValue), false);
});
