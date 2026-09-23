import type { ActionResult } from "../types.js";
import { ElementRegistry } from "../registry/elementRegistry.js";

function isSensitive(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && ["password", "hidden"].includes(element.type)) return true;
  const hint = `${element.getAttribute("name")} ${element.id} ${element.getAttribute("autocomplete")}`.toLowerCase();
  return /password|passcode|otp|one-time-code|credit|card|cvv|token|api.?key/.test(hint);
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
}

export function executeType(actionId: string, registry: ElementRegistry, ref: string, text: string, replace = true): ActionResult {
  const element = registry.get(ref);
  if (!element) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element ref is stale or unknown." };
  if (!element.isConnected) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element is no longer connected." };
  if (isSensitive(element)) return { ok: false, actionId, status: "failed", code: "SENSITIVE_FIELD", error: "Sensitive fields require an explicit safety flow." };
  const view = element.ownerDocument.defaultView;
  if (!view) return { ok: false, actionId, status: "failed", code: "FRAME_UNAVAILABLE", error: "Element document is unavailable." };
  const style = view.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_NOT_VISIBLE", error: "Element is not visible." };
  }
  if (("disabled" in element) && Boolean((element as HTMLInputElement).disabled)) {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_DISABLED", error: "Element is disabled." };
  }
  element.scrollIntoView({ block: "center", inline: "nearest" });
  element.focus({ preventScroll: true });
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const value = replace ? text : `${element.value}${text}`;
    setNativeValue(element, value);
    element.dispatchEvent(new view.Event("input", { bubbles: true }));
    element.dispatchEvent(new view.Event("change", { bubbles: true }));
    if (element.value !== value) return { ok: false, actionId, status: "failed", code: "INPUT_NOT_APPLIED", error: "O campo não aceitou o texto informado." };
    return { ok: true, actionId, status: "success", changed: true };
  }
  if (element.isContentEditable) {
    if (replace) element.textContent = text;
    else element.textContent = `${element.textContent ?? ""}${text}`;
    element.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    if ((element.textContent ?? "") !== (replace ? text : `${element.textContent ?? ""}`)) return { ok: false, actionId, status: "failed", code: "INPUT_NOT_APPLIED", error: "O campo editável não aceitou o texto informado." };
    return { ok: true, actionId, status: "success", changed: true };
  }
  return { ok: false, actionId, status: "failed", code: "UNSUPPORTED_CONTROL", error: "Element does not support text input." };
}
