import os from "node:os";
import { performance } from "node:perf_hooks";
import { build } from "esbuild";
import { chromium } from "playwright";
import { buildJevCommandMap } from "../dist/agent/provider/commandMap.js";

const nodeCount = 5000;
const fixture = [
  ...Array.from({ length: 100 }, (_, index) => `<section><label for="control-${index}">Controle ${index}</label><input id="control-${index}" type="text"><button>Opção ${index}</button></section>`),
  ...Array.from({ length: 4594 }, (_, index) => `<div data-row="${index}">Conteúdo fixture ${index}</div>`),
].join("");
const bundle = await build({
  stdin: {
    contents: 'import { scanPage } from "./dist/agent/scanner/pageScanner.js"; import { ElementRegistry } from "./dist/agent/registry/elementRegistry.js"; globalThis.runScanner = (doc, win, registry) => scanPage(doc, win, registry); globalThis.makeRegistry = () => new ElementRegistry();',
    resolveDir: process.cwd(),
    sourcefile: "bench-scanner-entry.js",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome120",
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(`<!doctype html><html><head><title>Scanner benchmark</title></head><body><main>${fixture}</main></body></html>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const scanned = await page.evaluate(() => {
    const registry = globalThis.makeRegistry();
    for (let index = 0; index < 10; index += 1) globalThis.runScanner(document, window, registry);
    const times = [];
    let lastPage;
    for (let index = 0; index < 30; index += 1) {
      const startedAt = performance.now();
      lastPage = globalThis.runScanner(document, window, registry);
      times.push(performance.now() - startedAt);
    }
    return { times, page: lastPage };
  });
  const mapStartedAt = performance.now();
  const built = buildJevCommandMap("abra o controle 250", scanned.page);
  const commandMapMs = performance.now() - mapStartedAt;
  const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
  const firstCpu = os.cpus()[0];
  console.log(JSON.stringify({
    environment: { platform: `${os.type()} ${os.release()}`, architecture: os.arch(), node: process.version, cpu: firstCpu?.model ?? "unknown", logicalCores: os.cpus().length, browser: browser.version() },
    fixture: { nodeCount: await page.locator("*").count(), requestedNodes: nodeCount, scannedControls: scanned.page.elements.length, warmupScans: 10, measuredScans: scanned.times.length },
    scannerMs: { median: percentile(scanned.times, 0.5), p95: percentile(scanned.times, 0.95), max: Math.max(...scanned.times) },
    commandMapMs,
    decision: { optionCount: built.options.length, payloadBytes: built.map.state.browser.coverage.payloadBytes, targetPayloadBudgetBytes: 65536, targetOptionBudget: 60 },
    cachePolicy: "disabled; correctness is covered by fresh observations and browser interaction tests",
  }, null, 2));
  await page.close();
} finally {
  await browser.close();
}
