import type { ElementBounds, ElementRef, PageState, ScrollContainerRef } from "../types.js";
import { ElementRegistry } from "../registry/elementRegistry.js";
import { getAccessibleName, inferRole } from "./accessibility.js";
import { compactText, summarizePageText } from "./text.js";
import { isElementVisible } from "./visibility.js";

const interactiveSelector = [
  "a[href]", "button", "input", "textarea", "select", "[role=button]", "[role=link]",
  "[role=textbox]", "[role=checkbox]", "[role=radio]", "[role=combobox]", "[role=menuitem]",
  "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])",
].join(",");
const sensitiveInputTypes = new Set(["password", "hidden"]);

function collectInteractiveElements(root: ParentNode): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (element.matches(interactiveSelector)) elements.push(element);
    if (element.shadowRoot) elements.push(...collectInteractiveElements(element.shadowRoot));
  }
  return elements;
}

function collectScrollableElements(root: ParentNode): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const view = element.ownerDocument.defaultView;
    const style = view?.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const overflow = `${style?.overflowY ?? ""} ${style?.overflow ?? ""}`;
    if (element.scrollHeight > element.clientHeight + 8 && /auto|scroll/i.test(overflow) && rect.width > 0 && rect.height > 0) elements.push(element);
    if (element.shadowRoot) elements.push(...collectScrollableElements(element.shadowRoot));
  }
  return elements;
}

function getBounds(element: HTMLElement): ElementBounds {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
}

function sanitizedHref(element: HTMLElement): string | undefined {
  if (!(element instanceof HTMLAnchorElement) || !element.href) return undefined;
  try {
    const url = new URL(element.href);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isSensitive(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && sensitiveInputTypes.has(element.type)) return true;
  const hint = `${element.getAttribute("name")} ${element.id} ${element.getAttribute("autocomplete")}`.toLowerCase();
  return /password|passcode|otp|one-time-code|credit|card|cvv|token|api.?key/.test(hint);
}

function toElementRef(element: HTMLElement, ref: string, document: Document, window: Window): ElementRef {
  const input = element instanceof HTMLInputElement ? element : undefined;
  const select = element instanceof HTMLSelectElement ? element : undefined;
  return {
    ref,
    frameId: 0,
    tag: element.tagName.toLowerCase(),
    role: inferRole(element),
    name: getAccessibleName(element, document) || undefined,
    type: input?.type,
    placeholder: input?.placeholder || (element instanceof HTMLTextAreaElement ? element.placeholder : undefined),
    text: compactText(element.innerText || element.textContent || "", 160) || undefined,
    href: sanitizedHref(element),
    visible: isElementVisible(element, window),
    enabled: !(element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) || !element.disabled,
    checked: input?.type === "checkbox" || input?.type === "radio" ? input.checked : undefined,
    sensitive: isSensitive(element) || undefined,
    options: select ? Array.from(select.options).slice(0, 100).map((option) => ({ value: option.value, label: compactText(option.text, 120) })) : undefined,
    bounds: getBounds(element),
  };
}

function fingerprint(state: Omit<PageState, "fingerprint">): string {
  const source = `${state.url}|${state.title}|${state.elements.map((element) => `${element.ref}:${element.name}`).join("|")}`;
  let hash = 2166136261;
  for (const character of source) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `p_${(hash >>> 0).toString(36)}`;
}

export function scanPage(document: Document, window: Window, registry: ElementRegistry): PageState {
  registry.beginGeneration();
  const limitations: string[] = [];
  const elements: ElementRef[] = [];
  const candidates = collectInteractiveElements(document);

  for (const element of candidates) {
    if (!isElementVisible(element, window)) continue;
    const ref = registry.register(element);
    elements.push(toElementRef(element, ref, document, window));
    if (element.shadowRoot?.mode === "closed") limitations.push("closed_shadow_root_detected_or_suspected");
  }

  const scrollContainers: ScrollContainerRef[] = [];
  for (const element of collectScrollableElements(document).slice(0, 20)) {
    const ref = registry.register(element);
    const rect = element.getBoundingClientRect();
    scrollContainers.push({
      ref,
      label: element.getAttribute("aria-label") || element.id || element.getAttribute("role") || element.tagName.toLowerCase(),
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    });
  }

  const stateWithoutFingerprint = {
    url: window.location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY },
    pageTextSummary: summarizePageText(document),
    elements,
    scrollContainers,
    limitations: [...new Set(limitations)],
  };
  return { ...stateWithoutFingerprint, fingerprint: fingerprint(stateWithoutFingerprint) };
}
