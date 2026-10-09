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

test("agent loop stops when progress returns to an already observed page state", async () => {
  const states = ["state-a", "state-b", "state-a"];
  let observation = 0;
  const result = await runAgentLoop({
    observe: async () => ({ ...page, fingerprint: states[Math.min(observation++, states.length - 1)] }),
    decide: async () => ({ optionId: "toggle", action: { type: "click", target: { ref: "el_1_1" } }, probabilities: {} }),
    execute: async () => ({ ok: true, dispatched: true, changed: false }),
    verify: (before, after) => ({ ok: true, progressed: before.fingerprint !== after.fingerprint, reason: "state changed" }),
  }, 8);
  assert.equal(result.status, "stalled");
  assert.match(result.message, /estado já observado/);
  assert.equal(result.steps.length, 2);
});

test("agent loop shares bounded sanitized action history and permits distinct actions", async () => {
  const observedHistory = [];
  const result = await runAgentLoop({
    observe: async () => ({ ...page, fingerprint: `state-${observedHistory.length}` }),
    decide: async (_state, _signal, history) => {
      observedHistory.push(history);
      const count = history.length;
      return count < 2
        ? { optionId: `click-${count}`, action: { type: "click", target: { ref: `el_1_${count + 1}` } }, probabilities: {} }
        : { optionId: "finish", action: { type: "finish", status: "success", message: "feito" }, probabilities: {} };
    },
    execute: async (action, actionId) => ({ ok: true, actionId, changed: action.type === "click" }),
    verify: (_before, after, _action, actionResult) => ({ ok: true, progressed: actionResult.changed, evidence: [after.fingerprint], reason: "observed" }),
  }, 5);
  assert.equal(result.status, "success");
  assert.equal(result.history.length, 2);
  assert.equal(observedHistory[2].length, 2);
  assert.deepEqual(result.history.map((entry) => entry.type), ["click", "click"]);
});

test("success claims without task evidence return needs_help", async () => {
  const result = await runAgentLoop({
    observe: async () => page,
    decide: async () => ({ optionId: "finish", action: { type: "finish", status: "success", message: "feito" }, probabilities: {} }),
    execute: async () => ({ ok: true, changed: false }),
    verifyCompletion: () => ({ complete: false, reason: "A tarefa ainda não foi comprovada." }),
  });
  assert.equal(result.status, "needs_help");
  assert.match(result.message, /não foi comprovada/);
});

test("provider call budget returns partial progress with an explicit reason", async () => {
  const result = await runAgentLoop({
    observe: async () => page,
    decide: async () => ({ optionId: "scroll", action: { type: "scroll", direction: "down", amount: "viewport" }, probabilities: {} }),
    execute: async (_action, actionId) => ({ ok: true, actionId, changed: true }),
    verify: () => ({ ok: true, progressed: true, reason: "scrolled" }),
  }, 5, undefined, { maxProviderCalls: 1 });
  assert.equal(result.status, "max_provider_calls");
  assert.equal(result.steps.length, 1);
  assert.match(result.message, /progresso parcial/);
});

test("action history stores field metadata and value length without the typed value", async () => {
  const value = "private-email@example.test";
  let historyForFinish;
  const inputPage = { ...page, elements: [{ ref: "el_1_1", frameId: 0, tag: "input", role: "textbox", name: "Email", type: "email", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 200, height: 30 } }] };
  const result = await runAgentLoop({
    observe: async () => inputPage,
    decide: async (_state, _signal, history) => {
      if (history.length) {
        historyForFinish = history;
        return { optionId: "finish", action: { type: "finish", status: "success", message: "feito" }, probabilities: {} };
      }
      return { optionId: "type", action: { type: "type", target: { ref: "el_1_1" }, text: value }, probabilities: {} };
    },
    execute: async (_action, actionId) => ({ ok: true, actionId, changed: true }),
  });
  assert.equal(result.status, "success");
  assert.equal(historyForFinish[0].targetLabel, "Email");
  assert.equal(historyForFinish[0].valueLength, value.length);
  assert.equal(JSON.stringify(historyForFinish).includes(value), false);
});

test("stale refs are re-observed and re-decided without retrying the stale action", async () => {
  let executions = 0;
  let decisions = 0;
  let observations = 0;
  const result = await runAgentLoop({
    observe: async () => ({ ...page, fingerprint: observations++ === 0 ? "initial" : "refreshed" }),
    decide: async () => ({ optionId: `click-${++decisions}`, action: { type: "click", target: { ref: `el_1_${decisions}` } }, probabilities: {} }),
    execute: async (_action, actionId) => {
      executions += 1;
      return executions === 1
        ? { ok: false, actionId, code: "STALE_ELEMENT", error: "stale", dispatched: false }
        : { ok: true, actionId, changed: true };
    },
    verify: (_before, after, _action, actionResult) => ({ ok: true, progressed: actionResult.changed === true, evidence: [after.fingerprint], reason: "checked" }),
  }, 5, undefined, { maxProviderCalls: 2 });
  assert.equal(result.status, "max_provider_calls");
  assert.equal(executions, 2);
  assert.equal(decisions, 2);
});

test("provider retries only transient errors with a bounded backoff", async () => {
  let calls = 0;
  const result = await runAgentLoop({
    observe: async () => page,
    decide: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("offline"), { code: "PROVIDER_NETWORK_ERROR" });
      return { optionId: "finish", action: { type: "finish", status: "failed", message: "provider restored" }, probabilities: {} };
    },
    execute: async () => ({ ok: false }),
  }, 5, undefined, { maxProviderCalls: 3 });
  assert.equal(result.status, "failed");
  assert.equal(calls, 2);
});

test("uncertain post-action observation failure does not repeat a dispatched action", async () => {
  let executions = 0;
  const result = await runAgentLoop({
    observe: async () => page,
    decide: async () => ({ optionId: "send", action: { type: "click", target: { ref: "el_1_1" } }, probabilities: {} }),
    execute: async (_action, actionId) => { executions += 1; return { ok: true, actionId, dispatched: true }; },
    waitForEffect: async () => { throw new Error("tab became unavailable after dispatch"); },
  });
  assert.equal(result.status, "needs_help");
  assert.equal(executions, 1);
  assert.match(result.message, /Não vou repeti-la/);
});

test("an action with unknown effect cannot be dispatched again before reconciliation", async () => {
  let executions = 0;
  const result = await runAgentLoop({
    observe: async () => page,
    decide: async () => ({ optionId: "submit", action: { type: "click", target: { ref: "el_1_1" } }, probabilities: {} }),
    execute: async (_action, actionId) => { executions += 1; return { ok: true, actionId, dispatched: true, changed: false }; },
    verify: () => ({ ok: true, progressed: false, reason: "No semantic change yet." }),
  }, 5);
  assert.equal(result.status, "needs_help");
  assert.equal(executions, 1);
  assert.match(result.message, /efeito continua desconhecido/);
});
