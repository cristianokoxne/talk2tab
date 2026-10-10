import fs from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { build } from "esbuild";
import { chromium } from "playwright";
import { siteBenchmarkCases } from "./site-benchmark-cases.mjs";
import { JevProvider } from "../dist/agent/provider/jev.js";
import { buildJevCommandMap } from "../dist/agent/provider/commandMap.js";
import { runAgentLoop } from "../dist/agent/loop.js";
import { verifyAction } from "../dist/agent/verification.js";
import { waitForPageEffect } from "../dist/agent/waitForEffect.js";
import { safeTraceStep } from "../dist/agent/trace.js";

const envText = await fs.readFile(".env", "utf8").catch(() => "");
const localEnv = Object.fromEntries(envText.split(/\r?\n/).map((line) => {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!match) return null;
  return [match[1], match[2].replace(/^(['"])(.*)\1$/, "$2")];
}).filter(Boolean));
const bareLines = envText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.includes("="));
const apiKey = process.env.JEV_API_KEY || localEnv.JEV_API_KEY || localEnv.SYSTEM_ONE_API_KEY || localEnv.TYPESAFE_API_KEY || (bareLines.length === 1 ? bareLines[0] : undefined);
if (!apiKey) throw new Error("No recognized Jev key found; no key value is printed by this runner.");
const endpoint = process.env.JEV_ENDPOINT || localEnv.JEV_ENDPOINT || "https://api.typesafe.ai/v1/systemone";
const model = process.env.JEV_MODEL || localEnv.JEV_MODEL || "jev-latest";
const provider = new JevProvider({ id: "jev", endpoint, apiKey, model, timeoutMs: 30000 });

const bundle = await build({
  stdin: {
    contents: `
      import { ElementRegistry } from "./dist/agent/registry/elementRegistry.js";
      import { scanPage } from "./dist/agent/scanner/pageScanner.js";
      import { executeClick } from "./dist/agent/executor/click.js";
      import { executeType } from "./dist/agent/executor/type.js";
      import { executeSelect } from "./dist/agent/executor/select.js";
      import { executeScroll } from "./dist/agent/executor/scroll.js";
      import { executeKeyPress } from "./dist/agent/executor/keypress.js";
      const registry = new ElementRegistry("site_bench");
      globalThis.__siteBench = {
        observe: () => scanPage(document, window, registry),
        execute: (action, actionId) => {
          if (action.type === "click") return executeClick(actionId, registry, action.target.ref);
          if (action.type === "type") return executeType(actionId, registry, action.target.ref, action.text, action.replace);
          if (action.type === "select") return executeSelect(actionId, registry, action.target.ref, action.value);
          if (action.type === "scroll") return executeScroll(actionId, window, action, action.target?.ref ? registry.get(action.target.ref) : undefined);
          if (action.type === "keypress") return executeKeyPress(actionId, document, action.key);
          return { ok: false, dispatched: false, code: "UNSUPPORTED_ACTION", error: "Action is outside the read-only site benchmark." };
        },
      };
    `,
    resolveDir: process.cwd(), sourcefile: "site-benchmark-entry.js",
  },
  bundle: true, write: false, format: "iife", platform: "browser", target: "chrome120",
});

const requestedId = process.argv.find((value) => value.startsWith("--case="))?.slice("--case=".length);
const repetitions = requestedId ? 1 : 3;
const selectedCases = requestedId ? siteBenchmarkCases.filter(({ id }) => id === requestedId) : siteBenchmarkCases;
if (!selectedCases.length) throw new Error(`Unknown site benchmark case: ${requestedId}`);
const runRequested = process.argv.includes("--run");
console.log(JSON.stringify({ model, cases: selectedCases.length, domains: new Set(selectedCases.map(({ site }) => site)).size, repetitions, plannedRuns: selectedCases.length * repetitions, runRequested }, null, 2));
if (!runRequested) process.exit(0);

const browser = await chromium.launch({ headless: true });
const results = [];
let cursor = 0;
const workerCount = requestedId ? 1 : 2;
async function worker() {
  while (cursor < selectedCases.length * repetitions) {
    const runIndex = cursor++;
    const task = selectedCases[Math.floor(runIndex / repetitions)];
    const repetition = runIndex % repetitions + 1;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let page = await context.newPage();
    const startedAt = performance.now();
    let result;
    try {
      await page.addInitScript({ content: bundle.outputFiles[0].text });
      const response = await page.goto(task.url, { waitUntil: "domcontentloaded", timeout: 15000 });
      if (!response?.ok()) {
        results.push({ caseId: task.id, site: task.site, family: task.family, split: task.split, repetition, status: "site_unavailable", httpStatus: response?.status() ?? null, steps: [] });
        await context.close();
        continue;
      }
      await page.waitForTimeout(800);
      const initialUrl = page.url();
      const initialState = await page.evaluate(() => globalThis.__siteBench.observe());
      const initialMenuCount = initialState.elements.filter((element) => ["menuitem", "menuitemcheckbox", "menuitemradio"].includes(element.role)).length;
      let candidateOffset = 0;
      let stateForDispatch = initialState;
      const chosenTargetKinds = [];
      result = await runAgentLoop({
        observe: async () => {
          stateForDispatch = await page.evaluate(() => globalThis.__siteBench.observe());
          return stateForDispatch;
        },
        decide: async (state, signal, history = []) => {
          const started = performance.now();
          const { map, options } = buildJevCommandMap(task.objective, state, [], history.map((entry) => entry.type), candidateOffset, history);
          const mapMs = performance.now() - started;
          const decision = await provider.chooseNextAction(map, options, signal);
          const targetRef = "target" in decision.action ? decision.action.target?.ref : undefined;
          const target = targetRef ? state.elements.find((element) => element.ref === targetRef) : undefined;
          const targetLabel = `${target?.name ?? ""} ${target?.text ?? ""}`.toLocaleLowerCase();
          chosenTargetKinds.push(target
            ? /search|submit|pesquis|buscar|go/i.test(targetLabel) ? "search_control"
              : task.query && targetLabel.includes(task.query.toLocaleLowerCase()) ? "query_suggestion"
                : target.role === "link" ? "link" : target.role === "button" ? "button" : "other_control"
            : "no_dom_target");
          return { ...decision, commandMapMs: mapMs };
        },
        execute: async (action, actionId) => {
          if (action.type === "expand_candidates") {
            candidateOffset = action.nextOffset;
            return { ok: true, dispatched: false, changed: true };
          }
          if (action.type === "navigate") {
            const url = new URL(action.url);
            if (!/^https?:$/.test(url.protocol)) return { ok: false, dispatched: false, code: "UNSUPPORTED_ACTION" };
            try {
              const navigation = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 12000 });
              return { ok: Boolean(navigation?.ok()), dispatched: true, changed: Boolean(navigation?.ok()), code: navigation?.ok() ? undefined : "NAVIGATION_FAILED" };
            } catch { return { ok: false, dispatched: true, code: "NAVIGATION_FAILED" }; }
          }
          const targetRef = "target" in action ? action.target?.ref : undefined;
          const target = targetRef ? stateForDispatch.elements.find((element) => element.ref === targetRef) : undefined;
          if (target && /delete|remove|purchase|buy now|checkout|send|submit payment|subscribe|follow|donate|sign in|log in|login/i.test(`${target.name ?? ""} ${target.text ?? ""}`)) {
            return { ok: false, dispatched: false, code: "ACTION_NOT_AUTHORIZED", error: "Irreversible or authenticated target blocked by read-only benchmark." };
          }
          return page.evaluate(({ action: requestedAction, id }) => globalThis.__siteBench.execute(requestedAction, id), { action, id: actionId });
        },
        verify: (before, after, action, actionResult) => action.type === "expand_candidates"
          ? { ok: true, progressed: true, effectObserved: true, evidence: ["candidate_options_expanded"], reason: "Mais opções foram apresentadas ao decisor." }
          : verifyAction(before, after, action, actionResult),
        waitForEffect: async (before, action, actionResult, observe, signal) => {
          if (action.type === "expand_candidates") return before;
          if (action.type === "scroll") return observe();
          return waitForPageEffect(observe, before, signal, { timeoutMs: 1800, pollIntervalMs: 60, quietWindowMs: 100 });
        },
        verifyCompletion: (state) => {
          if (task.family === "scroll") return { complete: state.viewport.scrollY > 40, reason: "A página ainda não rolou." };
          if (task.family === "menu") {
            const menuCount = state.elements.filter((element) => ["menuitem", "menuitemcheckbox", "menuitemradio"].includes(element.role)).length;
            return { complete: menuCount > initialMenuCount, reason: "O menu solicitado não foi observado como aberto." };
          }
          if (task.family === "navigation") return { complete: page.url() !== initialUrl, reason: "A navegação solicitada ainda não foi observada." };
          const query = task.query?.toLocaleLowerCase();
          if (task.family === "results") return { complete: page.url() !== initialUrl, reason: "Nenhum resultado foi aberto." };
          const params = [...new URL(page.url()).searchParams.values()].join(" ").toLocaleLowerCase();
          const pageText = `${state.title} ${state.pageTextSummary}`.toLocaleLowerCase();
          return { complete: Boolean(query && (params.includes(query) || pageText.includes(query))), reason: "A busca não foi confirmada no URL nem no conteúdo observado." };
        },
        onTrace: () => undefined,
      }, 6, undefined, { maxDurationMs: 45000, maxProviderCalls: 7 });

      const finalState = await page.evaluate(() => globalThis.__siteBench.observe()).catch(() => undefined);
      const finalUrl = finalState ? new URL(finalState.url) : undefined;
      const queryObserved = task.query ? [...(finalUrl?.searchParams.values() ?? [])].join(" ").toLocaleLowerCase().includes(task.query.toLocaleLowerCase())
        || `${finalState?.title ?? ""} ${finalState?.pageTextSummary ?? ""}`.toLocaleLowerCase().includes(task.query.toLocaleLowerCase()) : undefined;
      results.push({
        caseId: task.id, site: task.site, family: task.family, split: task.split, repetition,
        status: result.status, elapsedMs: Math.round(performance.now() - startedAt), stepCount: result.steps.length,
        actionTypes: result.steps.map((step) => step.action.type),
        targetKinds: chosenTargetKinds,
        optionCounts: result.steps.map((step) => step.optionCount ?? 0),
        errors: result.steps.map((step) => step.result?.code).filter(Boolean).map((code) => /^[A-Z_0-9]+$/.test(code) ? code : "ACTION_FAILED"),
        finalHost: finalUrl?.host ?? null, finalPath: finalUrl?.pathname ?? null, queryObserved,
        trace: result.steps.map(safeTraceStep),
      });
    } catch (error) {
      results.push({ caseId: task.id, site: task.site, family: task.family, split: task.split, repetition, status: "runner_error", errorCode: error?.name === "TimeoutError" ? "TIMEOUT" : "RUNNER_ERROR", elapsedMs: Math.round(performance.now() - startedAt), steps: [] });
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}
try {
  await Promise.all(Array.from({ length: workerCount }, worker));
} finally {
  await browser.close();
}

const summarize = (entries) => ({
  total: entries.length,
  successful: entries.filter(({ status }) => status === "success").length,
  successRate: entries.length ? entries.filter(({ status }) => status === "success").length / entries.length : null,
  byStatus: Object.fromEntries([...new Set(entries.map(({ status }) => status))].sort().map((status) => [status, entries.filter((entry) => entry.status === status).length])),
});
const families = [...new Set(results.map(({ family }) => family))].sort();
const splits = [...new Set(results.map(({ split }) => split))].sort();
const summary = {
  overall: summarize(results),
  byFamily: Object.fromEntries(families.map((family) => [family, summarize(results.filter((entry) => entry.family === family))])),
  bySplit: Object.fromEntries(splits.map((split) => [split, summarize(results.filter((entry) => entry.split === split))])),
  byFamilyAndSplit: Object.fromEntries(families.map((family) => [family, Object.fromEntries(splits.map((split) => [split, summarize(results.filter((entry) => entry.family === family && entry.split === split))]))])),
};
const canonicalCaseSet = JSON.stringify(selectedCases.map(({ id, site, url, objective, family, split, query }) => ({ id, site, url, objective, family, split, query })));
const caseSetHash = createHash("sha256").update(canonicalCaseSet).digest("hex");
const report = { generatedAt: new Date().toISOString(), model, environment: { platform: `${os.type()} ${os.release()}`, architecture: os.arch(), node: process.version, browser: browser.version() }, design: { caseSetHash, tasks: selectedCases.length, domains: new Set(selectedCases.map(({ site }) => site)).size, repetitions, holdoutTasks: selectedCases.filter(({ split }) => split === "holdout").length, families }, summary, results };
const timestamp = report.generatedAt.slice(0, 19).replaceAll(":", "-");
const path = requestedId
  ? `docs/validation/E19-sites-pilot-${timestamp}-${requestedId}.json`
  : `docs/validation/E19-sites-${timestamp}.json`;
await fs.writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ reportPath: path, summary: summary.overall, byFamily: summary.byFamily, bySplit: summary.bySplit, totalRuns: results.length }, null, 2));
