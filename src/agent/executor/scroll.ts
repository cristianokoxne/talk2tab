import type { ActionResult, ScrollAction } from "../types.js";

export function executeScroll(actionId: string, window: Window, action: ScrollAction): ActionResult {
  const amount = action.amount === "viewport" ? Math.max(window.innerHeight * 0.8, 1) : action.amount;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
    return { ok: false, actionId, status: "failed", code: "INVALID_SCROLL_AMOUNT", error: "Scroll amount is invalid." };
  }
  const delta = action.direction === "down" ? amount : -amount;
  window.scrollBy({ top: delta, left: 0, behavior: "instant" });
  return { ok: true, actionId, status: "success", changed: true };
}
