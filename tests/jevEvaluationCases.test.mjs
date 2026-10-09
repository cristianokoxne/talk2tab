import assert from "node:assert/strict";
import test from "node:test";
import { evaluationCases } from "../scripts/jev-evaluation-cases.mjs";

test("Jev evaluation has 100 unique labeled cases split by page template", () => {
  assert.equal(evaluationCases.length, 100);
  assert.equal(new Set(evaluationCases.map(({ id }) => id)).size, 100);
  assert.equal(new Set(evaluationCases.map(({ template }) => template)).size, 10);
  assert.equal(evaluationCases.filter(({ split }) => split === "holdout").length, 30);
  for (const scenario of evaluationCases) {
    const choices = new Set(scenario.controls.map(({ id }) => id));
    assert.ok(scenario.acceptable.length > 0);
    assert.ok(scenario.acceptable.every((id) => choices.has(id)), `${scenario.id} has an absent labeled candidate`);
  }
});

test("structural and history contexts add only controlled evidence to the same choices", () => {
  for (const scenario of evaluationCases) {
    assert.equal(scenario.controls.length, 5);
    assert.ok(scenario.structural.pageRegion);
    assert.ok(scenario.history.length > 0);
  }
});
