import type { ActionResult } from "../types.js";
import { ElementRegistry } from "../registry/elementRegistry.js";

export function executeClick(actionId: string, registry: ElementRegistry, ref: string): ActionResult {
  const element = registry.get(ref);
  if (!element) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element ref is stale or unknown." };
  if (!element.isConnected) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element is no longer connected." };
  const view = element.ownerDocument.defaultView;
  if (!view) return { ok: false, actionId, status: "failed", code: "FRAME_UNAVAILABLE", error: "Element document is unavailable." };
  const style = view.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_NOT_VISIBLE", error: "Element is not visible." };
  }
  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_DISABLED", error: "Element is disabled." };
  }
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.inert || ancestor.hasAttribute("inert") || ancestor.getAttribute("aria-hidden") === "true") {
      return { ok: false, actionId, status: "failed", code: "ELEMENT_UNAVAILABLE", error: "Element is inside an inert or hidden region." };
    }
  }
  element.scrollIntoView({ block: "center", inline: "nearest" });
  const hitTest = element.ownerDocument.elementFromPoint;
  if (typeof hitTest === "function") {
    const updated = element.getBoundingClientRect();
    const hit = hitTest.call(element.ownerDocument, updated.left + updated.width / 2, updated.top + updated.height / 2);
    if (hit && hit !== element && !element.contains(hit)) {
      return { ok: false, actionId, status: "failed", code: "CLICK_OBSCURED", error: "Another element covers the target." };
    }
  }
  element.focus({ preventScroll: true });
  element.click();
  return { ok: true, actionId, status: "success", dispatched: true, changed: false };
}
