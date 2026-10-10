import assert from "node:assert/strict";
import test from "node:test";

const { sanitizeSafeTraceStep, makeSafeTraceFromSteps } = await import("../dist/agent/trace.js");

test("safe trace keeps diagnostic facts while removing page and provider content", () => {
  const secret = "CANARY-private-value-7f3c";
  const step = sanitizeSafeTraceStep({
    step: 1,
    actionType: "type",
    targetRole: `button ${secret}`,
    targetFrameId: 0,
    expectedEffect: secret,
    option: `ref_${secret}`,
    availableActions: ["click", "type", secret],
    confidence: 0.91,
    model: `provider-${secret}`,
    observationMs: 18,
    commandMapMs: 4,
    callLatencyMs: 350,
    serializationMs: 1,
    payloadBytes: 1200,
    optionCount: 7,
    waitMs: 450,
    dispatched: true,
    actionOk: true,
    effectObserved: false,
    progressed: false,
    evidence: ["url_changed", secret],
    waitOutcome: secret,
    errorCode: secret,
  });

  const exported = JSON.stringify(makeSafeTraceFromSteps("needs_help", [step]));
  assert.doesNotMatch(exported, /CANARY|private-value|provider-/);
  assert.match(exported, /"actionType":"type"/);
  assert.match(exported, /"callLatencyMs":350/);
  assert.match(exported, /"errorCode":"ACTION_FAILED"/);
  assert.equal(JSON.parse(exported).steps[0].option, undefined);
});

test("safe trace limits history and only accepts known roles and Jev choices", () => {
  const steps = Array.from({ length: 60 }, (_, index) => ({
    step: index + 1,
    actionType: "click",
    targetRole: "button",
    option: `choice_${String(index + 1).padStart(3, "0")}`,
    availableActions: ["click"],
    evidence: [],
  }));
  const trace = makeSafeTraceFromSteps("success", steps);
  assert.equal(trace.steps.length, 50);
  assert.equal(trace.steps[0].step, 11);
  assert.equal(trace.steps[0].option, "choice_011");
  assert.ok(trace.metrics.traceBytes > 0);
});
