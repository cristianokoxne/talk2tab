import assert from "node:assert/strict";
import test from "node:test";

const { validateNavigationUrl, isRestrictedDocumentUrl, makeUninspectablePage, findSpawnedChildTab } = await import("../dist/agent/navigation.js");
const { buildJevCommandMap } = await import("../dist/agent/provider/commandMap.js");

test("navigation accepts HTTP(S) and rejects executable, local and credential-bearing URLs", () => {
  assert.equal(validateNavigationUrl("https://example.test/path"), "https://example.test/path");
  assert.equal(validateNavigationUrl("http://example.test"), "http://example.test/");
  for (const value of ["javascript:alert(1)", "file:///C:/secret.txt", "data:text/html,test", "https://user:pass@example.test", "not a URL"]) {
    assert.throws(() => validateNavigationUrl(value));
  }
});

test("restricted browser documents provide a navigation-only state without scanning", () => {
  assert.equal(isRestrictedDocumentUrl("chrome://newtab/"), true);
  assert.equal(isRestrictedDocumentUrl("about:blank"), true);
  assert.equal(isRestrictedDocumentUrl("https://example.test"), false);
  const restricted = makeUninspectablePage("chrome://newtab/", "Nova guia");
  const { map, options } = buildJevCommandMap("abra https://example.test", restricted);
  assert.equal(map.state.page.limitations.includes("UNINSPECTABLE_DOCUMENT"), true);
  assert.deepEqual(options.map((option) => option.action.type), ["navigate"]);
});

test("manual tabs are not mistaken for a child opened by the active page", () => {
  const before = new Set([1, 2]);
  const tabs = [
    { id: 1 }, { id: 2 },
    { id: 3, openerTabId: 1 },
    { id: 4 },
    { id: 5, openerTabId: 2 },
  ];
  assert.equal(findSpawnedChildTab(tabs, before, 1), 3);
  assert.equal(findSpawnedChildTab(tabs, before, 2), 5);
  assert.equal(findSpawnedChildTab(tabs, before, 99), undefined);
});

test("back and forward goals expose explicit browser history actions", () => {
  const state = makeUninspectablePage("chrome://newtab/", "Nova guia");
  assert.deepEqual(buildJevCommandMap("volte uma página", state).options.map((option) => option.action.type), ["go_back"]);
  assert.deepEqual(buildJevCommandMap("avance uma página", state).options.map((option) => option.action.type), ["go_forward"]);
});
