import type { ActionResult } from "../types.js";
import { ElementRegistry } from "../registry/elementRegistry.js";

export function executeSelect(actionId: string, registry: ElementRegistry, ref: string, value: string): ActionResult {
  const element = registry.get(ref);
  if (!element) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element ref is stale or unknown." };
  if (!element.isConnected) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element is no longer connected." };
  if (!(element instanceof HTMLSelectElement)) return { ok: false, actionId, status: "failed", code: "UNSUPPORTED_CONTROL", error: "Element is not a select control." };
  const view = element.ownerDocument.defaultView;
  if (!view) return { ok: false, actionId, status: "failed", code: "FRAME_UNAVAILABLE", error: "Element document is unavailable." };
  const rect = element.getBoundingClientRect();
  const style = view.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_NOT_VISIBLE", error: "Element is not visible." };
  }
  if (element.disabled) return { ok: false, actionId, status: "failed", code: "ELEMENT_DISABLED", error: "Element is disabled." };
  const option = Array.from(element.options).find((candidate) => candidate.value === value || candidate.text.trim() === value.trim());
  if (!option) return { ok: false, actionId, status: "failed", code: "OPTION_NOT_FOUND", error: "Select option was not found." };
  element.scrollIntoView({ block: "center", inline: "nearest" });
  element.focus({ preventScroll: true });
  element.value = option.value;
  element.dispatchEvent(new view.Event("input", { bubbles: true }));
  element.dispatchEvent(new view.Event("change", { bubbles: true }));
  return { ok: true, actionId, status: "success", changed: true };
}
