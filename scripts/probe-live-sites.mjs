import { performance } from "node:perf_hooks";
import { build } from "esbuild";
import { chromium } from "playwright";

const sites = [
  ["wikipedia", "https://www.wikipedia.org/"],
  ["mdn", "https://developer.mozilla.org/en-US/"],
  ["github", "https://github.com/"],
  ["npm", "https://www.npmjs.com/"],
  ["stackoverflow", "https://stackoverflow.com/"],
  ["duckduckgo", "https://duckduckgo.com/"],
  ["bing", "https://www.bing.com/"],
  ["google", "https://www.google.com/"],
  ["youtube", "https://www.youtube.com/"],
  ["reddit", "https://www.reddit.com/"],
  ["hackernews", "https://news.ycombinator.com/"],
  ["python-docs", "https://docs.python.org/3/"],
  ["chrome-developer", "https://developer.chrome.com/"],
  ["gitlab", "https://gitlab.com/"],
  ["jsdelivr", "https://www.jsdelivr.com/"],
  ["devto", "https://dev.to/"],
  ["vimeo", "https://vimeo.com/"],
  ["w3schools", "https://www.w3schools.com/"],
  ["w3", "https://www.w3.org/"],
  ["openstreetmap", "https://www.openstreetmap.org/"],
  ["archive", "https://archive.org/"],
  ["bbc", "https://www.bbc.com/"],
  ["imdb", "https://www.imdb.com/"],
  ["sourceforge", "https://sourceforge.net/"],
];

const bundle = await build({
  stdin: {
    contents: 'import { scanPage } from "./dist/agent/scanner/pageScanner.js"; import { ElementRegistry } from "./dist/agent/registry/elementRegistry.js"; globalThis.scanLivePage = () => scanPage(document, window, new ElementRegistry());',
    resolveDir: process.cwd(), sourcefile: "live-site-probe.js",
  },
  bundle: true, write: false, format: "iife", platform: "browser", target: "chrome120",
});
const browser = await chromium.launch({ headless: true });
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < sites.length) {
    const [site, url] = sites[cursor++];
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const started = performance.now();
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(1000);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const scan = await page.evaluate(() => {
        const state = globalThis.scanLivePage();
        const counts = Object.groupBy ? Object.groupBy(state.elements, (element) => element.role) : state.elements.reduce((groups, element) => ((groups[element.role] ??= []).push(element), groups), {});
        return { controls: state.elements.length, roles: Object.fromEntries(Object.entries(counts).map(([role, values]) => [role, values.length])), limitations: state.limitations.length };
      });
      results.push({ site, status: response?.status() ?? null, finalHost: new URL(page.url()).host, scanMs: Math.round(performance.now() - started), ...scan });
    } catch (error) {
      results.push({ site, status: null, scanMs: Math.round(performance.now() - started), errorCode: error?.name === "TimeoutError" ? "TIMEOUT" : "SITE_UNAVAILABLE" });
    } finally {
      await page.close();
    }
  }
}
try {
  await Promise.all(Array.from({ length: 3 }, worker));
} finally {
  await browser.close();
}
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), sites: results }, null, 2));
