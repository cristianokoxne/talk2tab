import fs from "node:fs/promises";
import { evaluationCases } from "./jev-evaluation-cases.mjs";

let endpoint = process.env.JEV_ENDPOINT || "https://system-one.dev/v1/systemone";
const envText = await fs.readFile(".env", "utf8").catch(() => "");
const localEnv = Object.fromEntries(envText.split(/\r?\n/).map((line) => {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!match) return null;
  return [match[1], match[2].replace(/^(['"])(.*)\1$/, "$2")];
}).filter(Boolean));
const bareLines = envText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.includes("="));
const apiKey = process.env.JEV_API_KEY || localEnv.JEV_API_KEY || localEnv.SYSTEM_ONE_API_KEY || localEnv.TYPESAFE_API_KEY || (bareLines.length === 1 ? bareLines[0] : undefined);
if (!apiKey) {
  console.error(JSON.stringify({ error: "No recognized Jev key found.", configuredVariables: Object.keys(localEnv) }));
  process.exit(2);
}

const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" };
let catalogResponse = await fetch(new URL("models", endpoint), { headers: { authorization: headers.authorization, accept: "application/json" } });
if (catalogResponse.status === 401 && !process.env.JEV_ENDPOINT) {
  endpoint = "https://api.typesafe.ai/v1/systemone";
  catalogResponse = await fetch(new URL("models", endpoint), { headers: { authorization: headers.authorization, accept: "application/json" } });
}
if (!catalogResponse.ok) throw new Error(`Model catalog request failed with HTTP ${catalogResponse.status}.`);
const catalog = await catalogResponse.json();
const jevModels = (catalog.models ?? []).filter((entry) => /jev/i.test(`${entry.name} ${entry.displayName ?? ""}`));
const requestedModel = process.env.JEV_MODEL || localEnv.JEV_MODEL || "jev-latest";
const model = jevModels.find((entry) => entry.name === requestedModel);
if (!model) {
  console.error(JSON.stringify({ requestedModel, availableJevModels: jevModels.map(({ name, displayName, pricing, limits }) => ({ name, displayName, pricing, limits })) }, null, 2));
  process.exit(2);
}
const reservedOnly = process.argv.includes("--reserved-only");
const selectedCases = reservedOnly ? evaluationCases.filter(({ split }) => split === "holdout") : evaluationCases;
const modes = reservedOnly ? ["structural", "history"] : ["baseline", "structural", "history"];
console.log(JSON.stringify({ catalog: "available", model: model.name, pricing: model.pricing, limits: model.limits, cases: selectedCases.length, modes, repetitions: 3, plannedRequests: selectedCases.length * modes.length * 3 }, null, 2));
if (!process.argv.includes("--run")) process.exit(0);

const repetitions = 3;
const results = [];
let cursor = 0;
const workerCount = 4;
async function worker() {
  while (cursor < selectedCases.length * modes.length * repetitions) {
    const taskIndex = cursor++;
    const repetition = taskIndex % repetitions;
    const modeIndex = Math.floor(taskIndex / repetitions) % modes.length;
    const caseIndex = Math.floor(taskIndex / (repetitions * modes.length));
    const scenario = selectedCases[caseIndex];
    const mode = modes[modeIndex];
    const state = mode === "baseline"
      ? { objective: scenario.objective, controls: scenario.controls.map(({ id, role, name }) => ({ id, role, name })) }
      : mode === "structural"
        ? { objective: scenario.objective, controls: scenario.controls, page: scenario.structural }
        : { objective: scenario.objective, controls: scenario.controls, page: scenario.structural, recentHistory: scenario.history };
    const body = {
      model: model.name,
      state,
      questions: {
        next_action: {
          type: "choice",
          instructions: "Which single available action best advances the user's objective? Choose only among the listed options.",
          criteria: Object.fromEntries(scenario.controls.map(({ id, role, name, context }) => [id, `${role}: ${name}${mode === "baseline" ? "" : `; context: ${context}`}`])),
        },
      },
    };
    const requestBytes = Buffer.byteLength(JSON.stringify(body));
    const started = performance.now();
    try {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
      const latencyMs = Math.round(performance.now() - started);
      const requestId = response.headers.get("x-request-id");
      const credits = response.headers.get("x-system-one-credits");
      if (!response.ok) {
        results.push({ caseId: scenario.id, template: scenario.template, split: scenario.split, mode, repetition, status: "http_error", httpStatus: response.status, requestId, latencyMs, credits, requestBytes });
        return;
      }
      const payload = await response.json();
      const answer = payload.answers?.next_action;
      const choice = answer?.choice;
      const available = new Set(scenario.controls.map(({ id }) => id));
      const valid = typeof choice === "string" && available.has(choice);
      results.push({
        caseId: scenario.id, template: scenario.template, split: scenario.split, mode, repetition,
        status: valid ? "ok" : "invalid_choice", choice: typeof choice === "string" ? choice : null,
        acceptable: scenario.acceptable, candidatePresent: scenario.acceptable.some((id) => available.has(id)),
        correct: valid && scenario.acceptable.includes(choice), modelReturned: payload.model ?? null,
        latencyMs, requestBytes, credits, requestId,
      });
    } catch (error) {
      results.push({ caseId: scenario.id, template: scenario.template, split: scenario.split, mode, repetition, status: "network_error", errorName: error?.name ?? "Error", requestBytes });
    }
  }
}
await Promise.all(Array.from({ length: workerCount }, worker));

const summarize = (selected) => {
  const valid = selected.filter((entry) => entry.status === "ok");
  const latencyEntries = selected.filter((entry) => Number.isFinite(entry.latencyMs));
  return {
    total: selected.length, valid: valid.length, invalid: selected.length - valid.length,
    candidateMissing: valid.filter((entry) => !entry.candidatePresent).length,
    correct: valid.filter((entry) => entry.correct).length,
    accuracy: valid.length ? valid.filter((entry) => entry.correct).length / valid.length : null,
    meanLatencyMs: latencyEntries.length ? Math.round(latencyEntries.reduce((sum, item) => sum + item.latencyMs, 0) / latencyEntries.length) : null,
    meanRequestBytes: selected.length ? Math.round(selected.reduce((sum, item) => sum + item.requestBytes, 0) / selected.length) : null,
    creditObservations: selected.filter((item) => item.credits !== null && item.credits !== undefined).length,
    creditsReported: selected.some((item) => item.credits !== null && item.credits !== undefined)
      ? selected.reduce((sum, item) => sum + (Number(item.credits) || 0), 0)
      : null,
  };
};
const generatedAt = new Date().toISOString();
const report = {
  generatedAt, adapterVersion: "2", requestedModel: model.name,
  returnedModels: [...new Set(results.map(({ modelReturned }) => modelReturned).filter(Boolean))],
  design: { cases: selectedCases.length, holdoutCases: selectedCases.filter(({ split }) => split === "holdout").length, templates: [...new Set(selectedCases.map(({ template }) => template))], modes, repetitions, workers: workerCount, reservedOnly },
  summary: Object.fromEntries(modes.map((mode) => [mode, summarize(results.filter((entry) => entry.mode === mode))])),
  holdout: Object.fromEntries(modes.map((mode) => [mode, summarize(results.filter((entry) => entry.mode === mode && entry.split === "holdout"))])),
  errorCount: results.filter((entry) => entry.status !== "ok").length,
  results,
};
const reportStage = reservedOnly ? "E19-jev" : "E06";
const reportPath = `docs/validation/${reportStage}-results-${generatedAt.slice(0, 10)}.json`;
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ reportPath, summary: report.summary, holdout: report.holdout, errorCount: report.errorCount }, null, 2));
if (Object.values(report.holdout).some((metrics) => metrics.accuracy === null || metrics.accuracy < 0.9) || report.errorCount > 0) process.exitCode = 1;
