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
  if ("disabled" in element && Boolean((element as HTMLButtonElement).disabled)) {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_DISABLED", error: "Element is disabled." };
  }
  element.scrollIntoView({ block: "center", inline: "nearest" });
  element.focus({ preventScroll: true });
  element.click();
  return { ok: true, actionId, status: "success", changed: true };
}
