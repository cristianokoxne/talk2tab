import fs from "node:fs/promises";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/summarize-site-development.mjs <E19-sites-report.json>");
const report = JSON.parse(await fs.readFile(path, "utf8"));
const development = report.results.filter(({ split }) => split === "development");
const group = (key) => Object.fromEntries([...new Set(development.map((entry) => entry[key]))].sort().map((value) => {
  const entries = development.filter((entry) => entry[key] === value);
  return [value, {
    total: entries.length,
    successful: entries.filter(({ status }) => status === "success").length,
    byStatus: Object.fromEntries([...new Set(entries.map(({ status }) => status))].sort().map((status) => [status, entries.filter((entry) => entry.status === status).length])),
  }];
}));
if (process.argv.includes("--cases") || process.argv.includes("--failures-only")) {
  console.log(JSON.stringify(Object.fromEntries([...new Set(development.map(({ caseId }) => caseId))].sort().map((caseId) => {
    const entries = development.filter((entry) => entry.caseId === caseId);
    if (process.argv.includes("--failures-only") && entries.every(({ status }) => status === "success")) return null;
    return [caseId, {
      total: entries.length,
      successful: entries.filter(({ status }) => status === "success").length,
      statuses: [...new Set(entries.map(({ status }) => status))],
      actionPatterns: [...new Set(entries.map(({ actionTypes }) => (actionTypes ?? []).join(" → ")))],
      queryObserved: [...new Set(entries.map(({ queryObserved }) => queryObserved ?? null))],
      targetKinds: [...new Set(entries.flatMap(({ targetKinds }) => targetKinds ?? []))],
    }];
  }).filter(Boolean)), null, 2));
  process.exit(0);
}
console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  developmentRuns: development.length,
  byFamily: group("family"),
  bySite: group("site"),
}, null, 2));
