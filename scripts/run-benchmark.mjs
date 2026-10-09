import assert from "node:assert/strict";
import { scenarios } from "../benchmarks/corpus.mjs";

export function verifyOracle(expected, actual, label = "benchmark oracle") {
  assert.deepEqual(actual, expected, `${label}: observed result differs from the expected result`);
}

const ids = new Set(scenarios.map(({ id }) => id));
assert.equal(scenarios.length, 120, "Expected exactly 120 catalogued cases");
assert.equal(ids.size, scenarios.length, "Scenario IDs must be unique");
for (const scenario of scenarios) {
  assert.ok(scenario.id && scenario.family && scenario.variant && scenario.ownerStage);
  assert.ok(scenario.objective && scenario.initialState && scenario.oracle && scenario.forbidden.length);
}

if (process.argv.includes("--provider") && process.argv[process.argv.indexOf("--provider") + 1] === "jev") {
  if (!process.env.JEV_API_KEY) {
    console.error("Jev benchmark not run: configure JEV_API_KEY and a reviewed, non-production case set before making provider calls.");
    process.exitCode = 2;
  } else {
    console.error("Jev benchmark adapter is not implemented yet; E06 owns real-provider replay.");
    process.exitCode = 2;
  }
} else {
  console.log(JSON.stringify({ total: scenarios.length, byStatus: { catalogued: scenarios.length }, families: new Set(scenarios.map(({ family }) => family)).size }, null, 2));
}
