import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { ElementRegistry } = await import("../dist/agent/registry/elementRegistry.js");
const { executeType } = await import("../dist/agent/executor/type.js");

test("type executor updates normal controls and blocks sensitive fields", async () => {
  const dom = new JSDOM(`<input id="name" value="Old"><input id="password" type="password">`);
  const { document } = dom.window;
  Object.assign(globalThis, { HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement });
  const inputs = [...document.querySelectorAll("input")];
  for (const input of inputs) {
    input.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0, toJSON: () => ({}) });
    input.scrollIntoView = () => {};
    input.focus = () => {};
  }
  const registry = new ElementRegistry();
  registry.beginGeneration();
  const nameRef = registry.register(inputs[0]);
  const passwordRef = registry.register(inputs[1]);
  assert.equal((await executeType("t1", registry, nameRef, "Cristiano")).ok, true);
  assert.equal(inputs[0].value, "Cristiano");
  assert.equal((await executeType("t2", registry, nameRef, " Koxne", false)).ok, true);
  assert.equal(inputs[0].value, "Cristiano Koxne");
  assert.equal((await executeType("t3", registry, passwordRef, "secret")).code, "SENSITIVE_FIELD");
});

test("native input constraints reject invalid type, range, step, and maxlength values", async () => {
  const dom = new JSDOM(`<input id="email" type="email"><input id="age" type="number" min="1" max="10" step="2"><input id="short" maxlength="3">`);
  const { document } = dom.window;
  Object.assign(globalThis, { HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement });
  const registry = new ElementRegistry(); registry.beginGeneration();
  const [email, age, short] = [...document.querySelectorAll("input")];
  for (const element of [email, age, short]) {
    element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0, toJSON: () => ({}) });
    element.scrollIntoView = () => {};
  }
  assert.equal((await executeType("v1", registry, registry.register(email), "not-an-email")).code, "INVALID_VALUE");
  assert.equal((await executeType("v2", registry, registry.register(age), "11")).code, "INVALID_VALUE");
  assert.equal((await executeType("v3", registry, registry.register(age), "4")).code, "INVALID_VALUE");
  assert.equal((await executeType("v4", registry, registry.register(short), "long")).code, "VALUE_TOO_LONG");
});

test("native date/time values use canonical values and empty replacement clears", async () => {
  const dom = new JSDOM(`<input id="date" type="date"><input id="time" type="time"><textarea id="notes">old</textarea>`);
  const { document } = dom.window;
  Object.assign(globalThis, { HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement });
  const registry = new ElementRegistry(); registry.beginGeneration();
  const [date, time] = [...document.querySelectorAll("input")];
  const notes = document.querySelector("textarea");
  for (const element of [date, time, notes]) {
    element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0, toJSON: () => ({}) });
    element.scrollIntoView = () => {};
  }
  assert.equal((await executeType("v5", registry, registry.register(date), "2026-10-09")).ok, true);
  assert.equal(date.value, "2026-10-09");
  assert.equal((await executeType("v6", registry, registry.register(time), "14:30")).ok, true);
  assert.equal(time.value, "14:30");
  assert.equal((await executeType("v7", registry, registry.register(notes), "")).ok, true);
  assert.equal(notes.value, "");
});

test("all supported native input types support fill, replace, and clear", async () => {
  const samples = [
    ["text", "first", "second"], ["search", "first", "second"], ["email", "a@example.com", "b@example.com"],
    ["tel", "+15555550123", "+15555550124"], ["url", "https://a.example", "https://b.example"],
    ["number", "12", "14"], ["date", "2026-10-09", "2026-10-10"], ["time", "14:30", "15:30"],
    ["datetime-local", "2026-10-09T14:30", "2026-10-10T15:30"], ["month", "2026-10", "2026-11"], ["week", "2026-W41", "2026-W42"],
  ];
  for (const [type, initial, replacement] of samples) {
    const dom = new JSDOM(`<input type="${type}">`);
    const { document } = dom.window;
    Object.assign(globalThis, { HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement });
    const input = document.querySelector("input");
    input.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0, toJSON: () => ({}) });
    input.scrollIntoView = () => {};
    const registry = new ElementRegistry(); registry.beginGeneration();
    const ref = registry.register(input);
    assert.equal((await executeType(`fill-${type}`, registry, ref, initial)).ok, true, `${type} should accept a value`);
    assert.equal(input.value, initial);
    assert.equal((await executeType(`replace-${type}`, registry, ref, replacement)).ok, true, `${type} should replace a value`);
    assert.equal(input.value, replacement);
    assert.equal((await executeType(`clear-${type}`, registry, ref, "")).ok, true, `${type} should clear`);
    assert.equal(input.value, "");
  }
});

test("controlled re-render acceptance is verified and reverted input is rejected", async () => {
  const dom = new JSDOM(`<input id="mask"><input id="rollback">`);
  const { document } = dom.window;
  Object.assign(globalThis, { HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement });
  const [masked, rollback] = [...document.querySelectorAll("input")];
  masked.value = "old"; rollback.value = "old";
  masked.addEventListener("input", () => setTimeout(() => { masked.value = masked.value.toUpperCase(); }, 60));
  rollback.addEventListener("input", () => setTimeout(() => { rollback.value = "old"; }, 60));
  const registry = new ElementRegistry(); registry.beginGeneration();
  for (const element of [masked, rollback]) {
    element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0, toJSON: () => ({}) });
    element.scrollIntoView = () => {};
  }
  const accepted = await executeType("v8", registry, registry.register(masked), "accepted");
  assert.equal(accepted.ok, true);
  assert.equal(masked.value, "ACCEPTED");
  const rejected = await executeType("v9", registry, registry.register(rollback), "rejected");
  assert.equal(rejected.code, "INPUT_REVERTED");
  assert.equal(rollback.value, "old");
});
