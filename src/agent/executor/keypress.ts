import type { ActionResult } from "../types.js";

const namedKeys = new Map<string, string>([
  ["ENTER", "Enter"], ["RETURN", "Enter"], ["ESCAPE", "Escape"], ["ESC", "Escape"],
  ["TAB", "Tab"], ["SPACE", " "], ["ARROWUP", "ArrowUp"], ["ARROWDOWN", "ArrowDown"],
  ["ARROWLEFT", "ArrowLeft"], ["ARROWRIGHT", "ArrowRight"], ["BACKSPACE", "Backspace"],
  ["DELETE", "Delete"],
]);

export function executeKeyPress(actionId: string, document: Document, key: string): ActionResult {
  const normalized = key.trim().toUpperCase().replace(/[-_ ]/g, "");
  const resolved = namedKeys.get(normalized) ?? (key.length === 1 ? key : undefined);
  if (!resolved) return { ok: false, actionId, status: "failed", code: "UNSUPPORTED_KEY", error: "Key is not allowed." };
  const target = document.activeElement ?? document.body;
  const view = document.defaultView;
  if (!view) return { ok: false, actionId, status: "failed", code: "FRAME_UNAVAILABLE", error: "Document window is unavailable." };
  const init = { key: resolved, code: resolved.length === 1 ? `Key${resolved.toUpperCase()}` : resolved, bubbles: true, cancelable: true };
  target.dispatchEvent(new view.KeyboardEvent("keydown", init));
  target.dispatchEvent(new view.KeyboardEvent("keyup", init));
  if (resolved === "Enter" && target instanceof view.HTMLElement) {
    const form = target.closest("form");
    if (form) {
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.submit();
    }
  }
  return { ok: true, actionId, status: "success", changed: true };
}
