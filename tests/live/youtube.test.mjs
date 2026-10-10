import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test, { before, after } from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
let context;
let worker;
let userData;

before(async () => {
  userData = await mkdtemp(join(tmpdir(), "talk2tab-live-youtube-"));
  context = await chromium.launchPersistentContext(userData, {
    headless: false,
    args: [`--disable-extensions-except=${join(root, "dist")}`, `--load-extension=${join(root, "dist")}`],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
});

after(async () => {
  await context?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("live YouTube search finds and opens a video through an actionable ref", { timeout: 90_000 }, async () => {
  const page = await context.newPage();
  try {
    const response = await page.goto("https://www.youtube.com/results?search_query=browser+automation", { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response?.ok(), `YouTube returned ${response?.status() ?? "no response"}`);
    await page.waitForFunction(() => [...document.querySelectorAll('a[href*="/watch"]')].some((link) => {
      const rect = link.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }), { timeout: 30_000 });

    const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, "https://www.youtube.com/");
    assert.ok(tabId, "YouTube tab should be visible to the extension worker");
    await worker.evaluate(async (targetTabId) => chrome.scripting.executeScript({ target: { tabId: targetTabId, allFrames: true }, files: ["contentScript.js"] }), tabId);
    const observation = await worker.evaluate(async ({ targetTabId, requestId }) => chrome.tabs.sendMessage(targetTabId, { type: "PAGE_SCAN_REQUEST", requestId }, { frameId: 0 }), { targetTabId: tabId, requestId: crypto.randomUUID() });
    assert.equal(observation.ok, true, "Extension content script should scan the live YouTube page");

    const searchInput = observation.data.elements.find((element) => element.tag === "input" && element.visible && element.bounds.y < 120);
    const videoLinks = observation.data.elements.filter((element) => element.role === "link" && element.visible && /youtube\.com\/watch\?/.test(element.href ?? ""));
    console.log(JSON.stringify({
      url: new URL(observation.data.url).origin + new URL(observation.data.url).pathname,
      visibleControls: observation.data.elements.filter((element) => element.visible).length,
      searchInput: searchInput ? { ref: searchInput.ref, role: searchInput.role, placeholder: searchInput.placeholder } : null,
      videoResultCount: videoLinks.length,
      firstVideo: videoLinks[0] ? { ref: videoLinks[0].ref, name: videoLinks[0].name ?? videoLinks[0].text } : null,
      limitations: observation.data.limitations,
    }));

    assert.ok(searchInput, "The live search input should have an actionable ref");
    assert.ok(videoLinks.length > 0, "At least one visible YouTube video result should have an actionable link ref");
    const click = await worker.evaluate(async ({ targetTabId, ref }) => chrome.tabs.sendMessage(targetTabId, {
      type: "EXECUTE_ACTION",
      actionId: crypto.randomUUID(),
      action: { type: "click", target: { ref } },
    }, { frameId: 0 }), { targetTabId: tabId, ref: videoLinks[0].ref });
    assert.equal(click.ok, true, `The selected video ref should click successfully: ${click.error ?? click.code ?? "unknown error"}`);
    await page.waitForURL((url) => url.pathname === "/watch" && url.searchParams.has("v"), { timeout: 20_000 });
    console.log(JSON.stringify({ openedVideoUrl: new URL(page.url()).origin + new URL(page.url()).pathname, clickedRef: videoLinks[0].ref }));
  } finally {
    await page.close();
  }
});
