import type { ActionResult } from "../types.js";
import { ElementRegistry } from "../registry/elementRegistry.js";

function optionGroup(option: HTMLOptionElement): string | undefined {
  return option.closest("optgroup")?.label.trim() || undefined;
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export async function executeSelect(actionId: string, registry: ElementRegistry, ref: string, value: string): Promise<ActionResult> {
  const element = registry.get(ref);
  if (!element) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element ref is stale or unknown." };
  if (!element.isConnected) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element is no longer connected." };
  const view = element.ownerDocument.defaultView;
  if (!view) return { ok: false, actionId, status: "failed", code: "FRAME_UNAVAILABLE", error: "Element document is unavailable." };
  if (!(element instanceof view.HTMLSelectElement)) {
    return { ok: false, actionId, status: "failed", code: "UNSUPPORTED_CONTROL", error: "Native selection requires a select control." };
  }
  const rect = element.getBoundingClientRect();
  const style = view.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_NOT_VISIBLE", error: "Element is not visible." };
  }
  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_DISABLED", error: "Element is disabled." };
  }
  if (element.multiple) {
    return { ok: false, actionId, status: "failed", code: "MULTIPLE_VALUES_REQUIRED", error: "This multi-select needs an explicit list of values." };
  }
  const groupMatch = value.match(/^(.+?)\s*[>›/]\s*(.+)$/);
  const requestedGroup = groupMatch?.[1].trim();
  const requestedLabel = groupMatch?.[2].trim() ?? value.trim();
  const options = Array.from(element.options).filter((candidate) => !candidate.disabled && !candidate.closest("optgroup")?.disabled);
  const byValue = options.filter((candidate) => candidate.value === value);
  let matches = byValue.length ? byValue : options.filter((candidate) => candidate.text.trim() === requestedLabel);
  if (requestedGroup) matches = matches.filter((candidate) => optionGroup(candidate) === requestedGroup);
  if (matches.length === 0) return { ok: false, actionId, status: "failed", code: "OPTION_NOT_FOUND", error: "An enabled option matching that value was not found." };
  if (matches.length > 1) return { ok: false, actionId, status: "failed", code: "AMBIGUOUS_OPTION", error: "More than one enabled option has that label; include its group." };
  const option = matches[0];
  const previous = element.value;
  element.scrollIntoView({ block: "center", inline: "nearest" });
  element.focus({ preventScroll: true });
  element.value = option.value;
  element.dispatchEvent(new view.Event("input", { bubbles: true }));
  element.dispatchEvent(new view.Event("change", { bubbles: true }));
  const started = Date.now();
  let current = element.value;
  let stableSince = Date.now();
  while (Date.now() - started < 800) {
    await delay(25);
    if (!element.isConnected) break;
    const next = element.value;
    if (next !== current) { current = next; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 100) break;
  }
  if (!element.isConnected) return { ok: false, actionId, status: "failed", code: "SELECTION_REPLACED", error: "The page replaced the select control before its selection could be confirmed; scan again." };
  if (element.value !== option.value) return { ok: false, actionId, status: "failed", code: "SELECTION_REVERTED", error: "The page did not keep the selected option." };
  return { ok: true, actionId, status: "success", changed: previous !== element.value, selectionLabel: [optionGroup(option), option.text.trim()].filter(Boolean).join(" › ") };
}
