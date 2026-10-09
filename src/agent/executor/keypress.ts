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
  let target = document.activeElement as HTMLElement | null;
  while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement as HTMLElement;
  target ??= document.body;
  const view = document.defaultView;
  if (!view) return { ok: false, actionId, status: "failed", code: "FRAME_UNAVAILABLE", error: "Document window is unavailable." };
  const init = { key: resolved, code: resolved.length === 1 ? `Key${resolved.toUpperCase()}` : resolved, bubbles: true, cancelable: true };
  let submits = 0;
  const form = resolved === "Enter" && target instanceof view.HTMLElement ? target.closest("form") : null;
  const onSubmit = () => { submits += 1; };
  let submitCalls = 0;
  const originalRequestSubmit = form?.requestSubmit;
  const originalSubmit = form?.submit;
  if (form && originalRequestSubmit) form.requestSubmit = function (...args) { submitCalls += 1; return originalRequestSubmit.apply(this, args); };
  if (form && originalSubmit) form.submit = function (...args) { submitCalls += 1; return originalSubmit.apply(this, args); };
  form?.addEventListener("submit", onSubmit);
  const keydown = new view.KeyboardEvent("keydown", init);
  target.dispatchEvent(keydown);
  target.dispatchEvent(new view.KeyboardEvent("keyup", init));
  form?.removeEventListener("submit", onSubmit);
  if (form && originalRequestSubmit) form.requestSubmit = originalRequestSubmit;
  if (form && originalSubmit) form.submit = originalSubmit;
  if (form && !keydown.defaultPrevented && submits === 0 && submitCalls === 0) {
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  }
  let changed = false;
  if (!keydown.defaultPrevented && resolved === "Escape") {
    const dialog = target.closest("dialog[open]") as HTMLDialogElement | null ?? document.querySelector<HTMLDialogElement>("dialog[open]");
    if (dialog) {
      const cancel = new view.Event("cancel", { bubbles: false, cancelable: true });
      if (dialog.dispatchEvent(cancel)) { dialog.close(); changed = true; }
    }
  }
  if (!keydown.defaultPrevented && resolved === "Tab") {
    const controls: HTMLElement[] = [];
    const collect = (root: ParentNode) => {
      for (const element of Array.from(root.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])"))) {
        if (element.matches(":disabled") || element.tabIndex < 0) continue;
        const rect = element.getBoundingClientRect();
        const style = view.getComputedStyle(element);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") continue;
        controls.push(element);
        if (element.shadowRoot) collect(element.shadowRoot);
      }
    };
    collect(document);
    const index = controls.indexOf(target);
    if (controls.length && index >= 0) {
      const next = controls[(index + 1) % controls.length];
      next.focus();
      changed = document.activeElement === next || next.getRootNode() instanceof view.ShadowRoot;
    }
  }
  return { ok: true, actionId, status: "success", dispatched: true, changed };
}
