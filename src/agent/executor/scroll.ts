import type { ActionResult, ScrollAction } from "../types.js";

export function executeScroll(actionId: string, window: Window, action: ScrollAction, target?: HTMLElement): ActionResult {
  const horizontal = action.direction === "left" || action.direction === "right";
  const amount = action.amount === "viewport"
    ? Math.max((target ? horizontal ? target.clientWidth : target.clientHeight : horizontal ? window.innerWidth : window.innerHeight) * 0.8, 1)
    : action.amount;
  if (action.direction === "top" || action.direction === "bottom") {
    if (target) {
      const before = target.scrollTop;
      target.scrollTop = action.direction === "top" ? 0 : Math.max(target.scrollHeight - target.clientHeight, 0);
      return { ok: true, actionId, status: "success", dispatched: true, changed: target.scrollTop !== before };
    }
    const before = window.scrollY;
    window.scrollTo({ top: action.direction === "top" ? 0 : Math.max(window.document.documentElement.scrollHeight - window.innerHeight, 0), behavior: "instant" });
    return { ok: true, actionId, status: "success", dispatched: true, changed: window.scrollY !== before };
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
    return { ok: false, actionId, status: "failed", code: "INVALID_SCROLL_AMOUNT", error: "Scroll amount is invalid." };
  }
  const delta = action.direction === "down" || action.direction === "right" ? amount : -amount;
  if (target) {
    const before = horizontal ? target.scrollLeft : target.scrollTop;
    const maximum = horizontal ? Math.max(target.scrollWidth - target.clientWidth, 0) : Math.max(target.scrollHeight - target.clientHeight, 0);
    if (horizontal) target.scrollLeft = Math.min(maximum, Math.max(0, before + delta));
    else target.scrollTop = Math.min(maximum, Math.max(0, before + delta));
    return { ok: true, actionId, status: "success", dispatched: true, changed: (horizontal ? target.scrollLeft : target.scrollTop) !== before };
  }
  const before = horizontal ? window.scrollX : window.scrollY;
  window.scrollBy({ top: horizontal ? 0 : delta, left: horizontal ? delta : 0, behavior: "instant" });
  return { ok: true, actionId, status: "success", dispatched: true, changed: (horizontal ? window.scrollX : window.scrollY) !== before };
}
