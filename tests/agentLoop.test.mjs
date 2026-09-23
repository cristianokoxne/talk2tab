import assert from "node:assert/strict";
import test from "node:test";

const { runAgentLoop } = await import("../dist/agent/loop.js");

const page = { url: "https://example.com", title: "Example", viewport: { width: 1, height: 1, scrollY: 0 }, pageTextSummary: "", fingerprint: "fp", elements: [], limitations: [] };

test("agent loop observes, executes and stops when Jev finishes", async () => {
  const calls = [];
  const result = await runAgentLoop({
    observe: async () => { calls.push("observe"); return page; },
    decide: async () => {
      calls.push("decide");
      return calls.filter((call) => call === "decide").length === 1
        ? { optionId: "scroll_down", action: { type: "scroll", direction: "down", amount: "viewport" }, confidence: 0.8, probabilities: {} }
        : { optionId: "finish_success", action: { type: "finish", status: "success", message: "feito" }, confidence: 0.99, probabilities: {} };
    },
    execute: async () => { calls.push("execute"); return { ok: true, actionId: "x", status: "success", changed: true }; },
  });
  assert.equal(result.status, "success");
  assert.equal(result.steps.length, 2);
  assert.deepEqual(calls, ["observe", "decide", "execute", "observe", "decide"]);
});

test("agent loop stops at the configured safety limit", async () => {
  const result = await runAgentLoop({
    observe: async () => page,
    decide: async () => ({ optionId: "scroll_down", action: { type: "scroll", direction: "down", amount: "viewport" }, probabilities: {} }),
    execute: async (_action, actionId) => ({ ok: true, actionId, status: "success", changed: true }),
  }, 2);
  assert.equal(result.status, "max_steps");
  assert.equal(result.steps.length, 2);
});

test("agent loop supports explicit cancellation", async () => {
  const controller = new AbortController();
  const result = await runAgentLoop({
    observe: async () => page,
    decide: async () => ({ optionId: "scroll_down", action: { type: "scroll", direction: "down", amount: "viewport" }, probabilities: {} }),
    execute: async () => { controller.abort(); return { ok: true, actionId: "x", status: "success", changed: true }; },
  }, 8, controller.signal);
  assert.equal(result.status, "cancelled");
  assert.equal(result.steps.length, 1);
});
