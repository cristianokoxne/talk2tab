import type { ActionResult } from "../types.js";
import { ElementRegistry } from "../registry/elementRegistry.js";

const supportedInputTypes = new Set([
  "text", "search", "email", "tel", "url", "number", "date", "time", "datetime-local", "month", "week",
]);

function isSensitive(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && ["password", "hidden", "file"].includes(element.type)) return true;
  const hint = `${element.getAttribute("name")} ${element.id} ${element.getAttribute("autocomplete")}`.toLowerCase();
  return /password|passcode|otp|one-time-code|credit|card|cvv|token|api.?key/.test(hint);
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for controlled components and masks to settle; never treat an immediate setter as acceptance. */
async function waitForStableValue(element: HTMLInputElement | HTMLTextAreaElement): Promise<string> {
  const started = Date.now();
  let latest = element.value;
  let stableSince = Date.now();
  while (Date.now() - started < 800) {
    await wait(25);
    if (!element.isConnected) return latest;
    const value = element.value;
    if (value !== latest) { latest = value; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 100) return value;
  }
  return element.value;
}

async function waitForStableEditor(element: HTMLElement): Promise<string> {
  const started = Date.now();
  let latest = element.textContent ?? "";
  let stableSince = Date.now();
  while (Date.now() - started < 800) {
    await wait(25);
    if (!element.isConnected) return latest;
    const value = element.textContent ?? "";
    if (value !== latest) { latest = value; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 100) return value;
  }
  return element.textContent ?? "";
}

export async function executeType(actionId: string, registry: ElementRegistry, ref: string, text: string, replace = true): Promise<ActionResult> {
  const element = registry.get(ref);
  if (!element) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element ref is stale or unknown." };
  if (!element.isConnected) return { ok: false, actionId, status: "failed", code: "STALE_ELEMENT", error: "Element is no longer connected." };
  if (isSensitive(element)) return { ok: false, actionId, status: "failed", code: "SENSITIVE_FIELD", error: "Sensitive fields require an explicit safety flow." };
  const view = element.ownerDocument.defaultView;
  if (!view) return { ok: false, actionId, status: "failed", code: "FRAME_UNAVAILABLE", error: "Element document is unavailable." };
  const nativeField = element instanceof view.HTMLInputElement || element instanceof view.HTMLTextAreaElement;
  const plainEditor = element.isContentEditable && !element.querySelector("img,table,video,iframe,svg,canvas,ul,ol,li,blockquote,pre,h1,h2,h3,strong,b,em,i,a,[contenteditable='false']") && !Array.from(element.children).some((child) => !["BR"].includes(child.tagName));
  if (!nativeField && !plainEditor) {
    return { ok: false, actionId, status: "failed", code: "UNSUPPORTED_CONTROL", error: "Text entry supports native fields and plain contenteditable areas; rich editors need a specialized interaction." };
  }
  if (element instanceof view.HTMLInputElement && !supportedInputTypes.has(element.type)) {
    return { ok: false, actionId, status: "failed", code: "UNSUPPORTED_CONTROL", error: "This input type requires a specialized interaction." };
  }
  if ((nativeField && (element as HTMLInputElement | HTMLTextAreaElement).readOnly) || element.getAttribute("aria-readonly") === "true") {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_READONLY", error: "Element is read-only." };
  }
  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_DISABLED", error: "Element is disabled." };
  }
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.inert || ancestor.hasAttribute("inert") || ancestor.getAttribute("aria-hidden") === "true") {
      return { ok: false, actionId, status: "failed", code: "ELEMENT_UNAVAILABLE", error: "Element is inside an inert or hidden region." };
    }
  }
  const style = view.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
    return { ok: false, actionId, status: "failed", code: "ELEMENT_NOT_VISIBLE", error: "Element is not visible." };
  }

  const field = nativeField ? element as HTMLInputElement | HTMLTextAreaElement : undefined;
  const previous = field?.value ?? element.textContent ?? "";
  const requested = replace ? text : `${previous}${text}`;
  if (field && field.maxLength >= 0 && requested.length > field.maxLength) {
    return { ok: false, actionId, status: "failed", code: "VALUE_TOO_LONG", error: "Text exceeds the field's maximum length." };
  }
  element.scrollIntoView({ block: "center", inline: "nearest" });
  element.focus({ preventScroll: true });
  if (field) {
    setNativeValue(field, requested);
    field.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: replace ? "insertReplacementText" : "insertText", data: text }));
  } else {
    const beforeInput = new view.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: replace ? "insertReplacementText" : "insertText", data: text });
    if (!element.dispatchEvent(beforeInput)) return { ok: false, actionId, status: "failed", code: "EDITOR_REJECTED", error: "The editor rejected the text before editing." };
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    if (!replace) range.collapse(false);
    range.deleteContents();
    range.insertNode(element.ownerDocument.createTextNode(text));
    element.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: replace ? "insertReplacementText" : "insertText", data: text }));
  }
  let accepted = field ? await waitForStableValue(field) : await waitForStableEditor(element);
  if (!element.isConnected) return { ok: false, actionId, status: "failed", code: "INPUT_REPLACED", error: "The page replaced the edited control before its value could be confirmed; scan again." };
  if (accepted === previous && requested !== previous) {
    return { ok: false, actionId, status: "failed", code: "INPUT_REVERTED", error: "The page reverted the field value after its update cycle." };
  }
  if (field) {
    field.blur();
    field.dispatchEvent(new view.Event("change", { bubbles: true }));
    accepted = await waitForStableValue(field);
    if (!element.isConnected) return { ok: false, actionId, status: "failed", code: "INPUT_REPLACED", error: "The page replaced the edited control before its committed value could be confirmed; scan again." };
  }
  if (accepted === previous && requested !== previous) {
    return { ok: false, actionId, status: "failed", code: "INPUT_REVERTED", error: "The page reverted the field value after blur or change." };
  }

  if (field && (field.validity.badInput || field.validity.typeMismatch || field.validity.rangeOverflow || field.validity.rangeUnderflow || field.validity.stepMismatch || field.validity.tooLong || field.validity.tooShort || field.validity.patternMismatch)) {
    setNativeValue(field, previous);
    field.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: null }));
    field.dispatchEvent(new view.Event("change", { bubbles: true }));
    return { ok: false, actionId, status: "failed", code: "INVALID_VALUE", error: "The value violates this field's native constraints." };
  }
  return { ok: true, actionId, status: "success", changed: accepted !== previous };
}
