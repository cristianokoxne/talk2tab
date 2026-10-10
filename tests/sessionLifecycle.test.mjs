import assert from "node:assert/strict";
import test from "node:test";
import { classifyVoiceCommand, isDuplicateVoiceSegment, latestSessionForTab, makeSessionCheckpoint, reconcileSessionCheckpoint, VoiceGoalQueue } from "../dist/agent/sessionLifecycle.js";

test("session checkpoints retain minimal context without query strings, refs, goals or secrets", () => {
  const checkpoint = makeSessionCheckpoint({
    requestId: "request-1", status: "running", phase: "dispatching", tabId: 7, step: 3,
    actionType: "click", pageUrl: "https://example.test/account?token=secret#private", pageFingerprint: "ref-and-secret-canary",
  }, 1234);
  assert.equal(checkpoint.requestId, "request-1");
  assert.equal(checkpoint.status, "running");
  assert.equal(checkpoint.phase, "dispatching");
  assert.equal(checkpoint.tabId, 7);
  assert.equal(checkpoint.pageOrigin, "https://example.test");
  assert.match(checkpoint.pageFingerprint, /^state_[a-f0-9]+$/);
  assert.equal(checkpoint.updatedAt, 1234);
  assert.equal(JSON.stringify(checkpoint).includes("secret"), false);
  assert.equal(JSON.stringify(checkpoint).includes("token="), false);
});

test("recovery distinguishes safe interruption from an action that may have dispatched", () => {
  const base = makeSessionCheckpoint({ requestId: "r", status: "running", phase: "deciding", tabId: 2, step: 1 }, 100);
  assert.equal(reconcileSessionCheckpoint(base, false).status, "interrupted");
  const pending = { ...base, phase: "action_dispatched" };
  assert.equal(reconcileSessionCheckpoint(pending, false).status, "needs_reconciliation");
  assert.equal(reconcileSessionCheckpoint(pending, true).status, "running");
  assert.equal(reconcileSessionCheckpoint({ ...base, status: "completed" }, false).status, "completed");
});

test("session recovery is scoped to the page tab instead of the currently focused unrelated tab", () => {
  const first = makeSessionCheckpoint({ requestId: "a", status: "running", phase: "deciding", tabId: 3, step: 1 }, 100);
  const second = makeSessionCheckpoint({ requestId: "b", status: "completed", phase: "deciding", tabId: 4, step: 2 }, 200);
  assert.equal(latestSessionForTab([first, second], 3)?.requestId, "a");
  assert.equal(latestSessionForTab([first, second], 4)?.requestId, "b");
  assert.equal(latestSessionForTab([first, second], 5), undefined);
});

test("stop commands are immediate while repeated final voice segments are deduplicated", () => {
  assert.equal(classifyVoiceCommand("Pare agora"), "cancel");
  assert.equal(classifyVoiceCommand("e depois abra o perfil"), "continuation");
  assert.equal(classifyVoiceCommand("pesquise por cafeterias"), "new");
  assert.equal(isDuplicateVoiceSegment(["Pesquise por cafés."], "pesquise por cafes"), true);
  const queue = new VoiceGoalQueue();
  assert.equal(queue.enqueue("Pesquise por cafés", 100).queued, true);
  assert.equal(queue.enqueue("pesquise por cafes", 200).queued, false);
  assert.equal(queue.enqueue("e depois abra o primeiro resultado", 300).kind, "continuation");
  assert.equal(queue.size, 1);
  assert.equal(queue.shift(), "Pesquise por cafés e depois abra o primeiro resultado");
  queue.clear();
  assert.equal(queue.size, 0);
  queue.enqueue("abra a seção de pedidos", 10000);
  queue.enqueue("e depois cancele o pedido", 10001);
  assert.equal(queue.shift(), "abra a seção de pedidos e depois cancele o pedido");
});
