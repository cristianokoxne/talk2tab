/**
 * Catalog of 120 deterministic acceptance scenarios. A case is deliberately
 * metadata-only until its owning implementation stage marks it runnable.
 * Keeping the matrix as data lets replay/reporting tools enforce coverage.
 */
const families = [
  ["NAV", "navigation", ["explicit URL", "domain only", "generic site name", "open in new tab", "restricted initial page"]],
  ["TAB", "tabs", ["same tab", "target blank", "popup", "existing tab", "manual focus change"]],
  ["SPA", "spa", ["route change", "hash change", "history back", "late render", "loading skeleton"]],
  ["SEA", "search", ["visible search field", "search icon first", "search in dialog", "Enter submit", "empty results"]],
  ["RES", "results", ["first organic result", "exclude sponsored result", "duplicate card labels", "sort results", "paginate"]],
  ["MEN", "menus", ["dropdown", "submenu", "hover menu", "menuitem role", "accordion"]],
  ["MOD", "dialogs", ["cookie dialog", "modal", "drawer", "backdrop", "nested dialog"]],
  ["INP", "input", ["text input", "search input", "email input", "number input", "textarea"]],
  ["VAL", "validation", ["required field", "readonly field", "disabled field", "max length", "server validation error"]],
  ["CTL", "controlled-input", ["rerender after input", "debounced value", "phone mask", "currency mask", "value reverted"]],
  ["CHK", "checkbox-radio", ["check", "uncheck", "radio group", "switch", "mixed state"]],
  ["SEL", "selection", ["native select", "optgroup", "multi-select", "custom listbox", "duplicate option labels"]],
  ["AUT", "autocomplete", ["remote suggestions", "no suggestion", "duplicate suggestions", "virtualized suggestions", "multiple tokens"]],
  ["DAT", "date-number", ["date input", "time input", "custom calendar", "range slider", "locale number"]],
  ["EDT", "editor", ["contenteditable", "multiline editor", "selected text", "rich text", "preserve adjacent content"]],
  ["SCR", "scroll", ["viewport", "nested panel", "horizontal table", "scroll snap", "already at boundary"]],
  ["VIR", "virtualized", ["virtualized list", "infinite scroll with results", "infinite scroll exhausted", "load more", "recycled DOM node"]],
  ["FRM", "frames", ["same-origin iframe", "authorized cross-origin iframe", "nested iframe", "lazy iframe", "frame navigation"]],
  ["ERR", "errors", ["offline", "provider timeout", "HTTP 429 or 5xx", "stale reference", "closed tab"]],
  ["SEC", "safety", ["confirmation approved", "confirmation rejected", "confirmation expired", "sensitive input", "hostile page instruction"]],
  ["LIFE", "lifecycle", ["worker restart", "panel reopen", "duplicate concurrent request", "voice command queue", "late provider response"]],
  ["A11Y", "accessibility", ["aria label", "labelledby", "describedby validation", "duplicate accessible names", "focus and tabindex"]],
  ["VIS", "layout", ["desktop viewport", "laptop viewport", "narrow viewport", "200 percent zoom", "right-to-left layout"]],
  ["ADV", "advanced", ["canvas control", "map control", "drag and drop", "file upload", "download action"]],
];

const stageByFamily = {
  NAV: "E07-E10", TAB: "E03,E10", SPA: "E09-E10", SEA: "E07-E13",
  RES: "E04-E08,E14", MEN: "E04,E11", MOD: "E04,E11,E16", INP: "E12",
  VAL: "E04,E12", CTL: "E12", CHK: "E11", SEL: "E13", AUT: "E09,E13",
  DAT: "E12-E13", EDT: "E13", SCR: "E14", VIR: "E14", FRM: "E15",
  ERR: "E03,E09", SEC: "E16", LIFE: "E17", A11Y: "E04,E11", VIS: "E04,E14,E19", ADV: "E20",
};

export const scenarios = families.flatMap(([prefix, family, variants]) => variants.map((variant, index) => ({
  id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
  family,
  variant,
  priority: ["navigation", "search", "results", "input", "scroll", "dialogs", "safety"].includes(family) ? "P0" : "P1",
  status: "catalogued",
  ownerStage: stageByFamily[prefix],
  objective: `${variant}: complete the requested interaction and report only observed outcomes.`,
  initialState: "Local deterministic fixture; no external accounts or effects.",
  oracle: "Assert the final semantic state, target identity, and prohibited side effects.",
  forbidden: ["wrong-target action", "success without an observed oracle", "duplicate external effect", "sensitive value in trace"],
}))).map((scenario) => Object.freeze(scenario));

if (scenarios.length !== 120 || new Set(scenarios.map((scenario) => scenario.id)).size !== 120) {
  throw new Error("Benchmark corpus must contain 120 unique scenarios.");
}

export function getScenario(id) {
  return scenarios.find((scenario) => scenario.id === id);
}
