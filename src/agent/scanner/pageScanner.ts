import type { ElementBounds, ElementRef, PageRegion, PageState, ScrollContainerRef } from "../types.js";
import { ElementRegistry } from "../registry/elementRegistry.js";
import { getAccessibleDescription, getAccessibleName, inferRole } from "./accessibility.js";
import { compactText, summarizePageText } from "./text.js";
import { isElementVisible } from "./visibility.js";

const interactiveSelector = [
  "a[href]", "button", "input", "textarea", "select", "summary", "[role=button]", "[role=link]",
  "[role=textbox]", "[role=checkbox]", "[role=radio]", "[role=switch]", "[role=tab]", "[role=option]",
  "[role=combobox]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]", "[role=treeitem]",
  "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])",
].join(",");
const sensitiveInputTypes = new Set(["password", "hidden", "file"]);
const semanticRegionSelector = "main,[role=main],nav,[role=navigation],form,[role=form],dialog,[role=dialog],section,article,li,[role=listitem],tr,[role=row],table,[role=table],[role=alert],[role=status]";

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
    const overflow = `${style?.overflowY ?? ""} ${style?.overflow ?? ""} ${style?.overflowX ?? ""}`;
    const hasVerticalRange = element.scrollHeight > element.clientHeight + 8 && /auto|scroll/i.test(`${style?.overflowY ?? ""} ${style?.overflow ?? ""}`);
    const hasHorizontalRange = element.scrollWidth > element.clientWidth + 8 && /auto|scroll/i.test(`${style?.overflowX ?? ""} ${style?.overflow ?? ""}`);
    if ((hasVerticalRange || hasHorizontalRange || /snap/.test(overflow) && element.scrollHeight > element.clientHeight + 8) && rect.width > 0 && rect.height > 0) elements.push(element);
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

function safeFrameUrl(frame: HTMLIFrameElement | HTMLFrameElement): string | undefined {
  const source = frame instanceof HTMLIFrameElement ? frame.src : frame.src;
  if (!source) return undefined;
  try {
    const url = new URL(source, frame.ownerDocument.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") return `${url.origin}${url.pathname}`;
    return `${url.protocol}//`;
  } catch { return undefined; }
}

function isSensitive(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && sensitiveInputTypes.has(element.type)) return true;
  const hint = `${element.getAttribute("name")} ${element.id} ${element.getAttribute("autocomplete")}`.toLowerCase();
  return /password|passcode|otp|one-time-code|credit|card|cvv|token|api.?key/.test(hint);
}

function regionKind(element: HTMLElement): string {
  if (element.matches("dialog,[role=dialog]")) return "dialog";
  if (element.matches("form,[role=form]")) return "form";
  if (element.matches("main,[role=main]")) return "main";
  if (element.matches("nav,[role=navigation]")) return "navigation";
  if (element.matches("[role=alert]")) return "alert";
  if (element.matches("[role=status]")) return "status";
  if (element.matches("li,[role=listitem]")) return "list item";
  if (element.matches("tr,[role=row]")) return "row";
  if (element.matches("article")) return "card";
  return element.tagName.toLowerCase();
}

function regionName(element: HTMLElement, document: Document): string | undefined {
  const heading = element.matches("h1,h2,h3,h4") ? "" : element.querySelector("h1,h2,h3,h4")?.textContent ?? "";
  const labelledBy = element.hasAttribute("aria-labelledby") ? getAccessibleName(element, document) : "";
  return compactText(element.getAttribute("aria-label") || labelledBy || element.getAttribute("title") || heading || "", 100) || undefined;
}

function describeRegion(element: HTMLElement, document: Document): string {
  const kind = regionKind(element);
  const name = regionName(element, document);
  const peers = element.parentElement ? Array.from(element.parentElement.children).filter((candidate) => candidate.matches(semanticRegionSelector)) : [];
  const index = peers.indexOf(element);
  const position = index >= 0 && peers.length > 1 ? ` ${index + 1}` : "";
  const text = compactText(element.innerText || element.textContent || "", 140);
  return `${kind}${position}${name ? ` “${name}”` : ""}${text ? `: ${text}` : ""}`;
}

function getElementContext(element: HTMLElement, document: Document): string | undefined {
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.matches(semanticRegionSelector)) return describeRegion(ancestor, document);
  }
  return undefined;
}

function getDeepActiveElement(document: Document): HTMLElement | undefined {
  let active = document.activeElement as HTMLElement | null;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement as HTMLElement;
  return active ?? undefined;
}

function collectRegions(root: ParentNode, document: Document, window: Window): PageRegion[] {
  const regions: PageRegion[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(semanticRegionSelector))) {
    if (!isElementVisible(element, window)) continue;
    const peers = element.parentElement ? Array.from(element.parentElement.children).filter((candidate) => candidate.matches(semanticRegionSelector)) : [];
    const index = peers.indexOf(element);
    regions.push({
      kind: regionKind(element),
      name: regionName(element, document),
      text: compactText(element.innerText || element.textContent || "", 320) || undefined,
      itemPosition: index >= 0 && peers.length > 1 ? index + 1 : undefined,
    });
    if (element.shadowRoot) regions.push(...collectRegions(element.shadowRoot, document, window));
  }
  return regions.slice(0, 40);
}

function getCheckedState(element: HTMLElement, input?: HTMLInputElement): { checked?: boolean; checkedState?: "mixed" } {
  const ariaChecked = element.getAttribute("aria-checked");
  if (ariaChecked === "mixed") return { checkedState: "mixed" };
  if (ariaChecked === "true" || ariaChecked === "false") return { checked: ariaChecked === "true" };
  return input?.type === "checkbox" || input?.type === "radio" ? { checked: input.checked } : {};
}

function toElementRef(element: HTMLElement, ref: string, document: Document, window: Window): ElementRef {
  const input = element instanceof HTMLInputElement ? element : undefined;
  const select = element instanceof HTMLSelectElement ? element : undefined;
  const button = element instanceof HTMLButtonElement ? element : undefined;
  const textarea = element instanceof HTMLTextAreaElement ? element : undefined;
  const role = inferRole(element);
  const ariaDisabled = element.getAttribute("aria-disabled") === "true";
  const invalid = element.getAttribute("aria-invalid") === "true" || element.matches(":invalid");
  return {
    ref,
    frameId: 0,
    tag: element.tagName.toLowerCase(),
    role,
    name: getAccessibleName(element, document) || undefined,
    description: getAccessibleDescription(element, document),
    context: element.matches(semanticRegionSelector) ? undefined : getElementContext(element, document),
    type: input?.type ?? (button?.getAttribute("type")?.toLowerCase() ?? (button?.form ? "submit" : undefined)),
    placeholder: input?.placeholder || (element instanceof HTMLTextAreaElement ? element.placeholder : undefined),
    text: compactText(element.innerText || element.textContent || "", 160) || undefined,
    href: sanitizedHref(element),
    visible: isElementVisible(element, window),
    enabled: !ariaDisabled && (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) || !element.disabled),
    required: input?.required || select?.required || textarea?.required || element.getAttribute("aria-required") === "true" || undefined,
    readOnly: input?.readOnly || textarea?.readOnly || element.getAttribute("aria-readonly") === "true" || undefined,
    invalid: invalid || undefined,
    expanded: element.getAttribute("aria-expanded") === "true" ? true : element.getAttribute("aria-expanded") === "false" ? false : undefined,
    ariaAutocomplete: element.getAttribute("aria-autocomplete") || undefined,
    controls: (element.getAttribute("aria-controls") ?? "").slice(0, 120) || undefined,
    selectedOptionLabel: select?.selectedOptions[0] ? compactText(select.selectedOptions[0].text, 120) : undefined,
    ...getCheckedState(element, input),
    selected: element.getAttribute("aria-selected") === "true" ? true : element.getAttribute("aria-selected") === "false" ? false : undefined,
    sensitive: isSensitive(element) || undefined,
    options: select ? Array.from(select.options).slice(0, 100).map((option) => ({
      value: option.value,
      label: compactText(option.text, 120),
      group: option.closest("optgroup")?.label.trim() || undefined,
      disabled: option.disabled || Boolean(option.closest("optgroup")?.disabled) || undefined,
    })) : undefined,
    bounds: getBounds(element),
  };
}

function fingerprint(state: Omit<PageState, "fingerprint">): string {
  const source = JSON.stringify({
    url: state.url,
    title: state.title,
    pageTextSummary: state.pageTextSummary,
    viewport: { scrollY: state.viewport.scrollY, scrollX: state.viewport.scrollX, scrollHeight: state.viewport.scrollHeight, scrollWidth: state.viewport.scrollWidth },
    activeDialog: state.activeDialog,
    scrollLocked: state.scrollLocked,
    embeddedFrames: state.embeddedFrames,
    elements: state.elements.map((element) => ({
      tag: element.tag,
      role: element.role,
      name: element.name,
      context: element.context,
      description: element.description,
      text: element.text,
      href: element.href,
      type: element.type,
      visible: element.visible,
      enabled: element.enabled,
      checked: element.checked,
      checkedState: element.checkedState,
      selected: element.selected,
      required: element.required,
      readOnly: element.readOnly,
      invalid: element.invalid,
      expanded: element.expanded,
      selectedOptionLabel: element.selectedOptionLabel,
      ariaAutocomplete: element.ariaAutocomplete,
    })),
    regions: state.regions,
    scrollContainers: state.scrollContainers?.map((container) => ({
      label: container.label,
      scrollTop: container.scrollTop,
      scrollLeft: container.scrollLeft,
      clientHeight: container.clientHeight,
      clientWidth: container.clientWidth,
      scrollHeight: container.scrollHeight,
      scrollWidth: container.scrollWidth,
      scrollSnapType: container.scrollSnapType,
      context: container.context,
    })),
  });
  let hash = 2166136261;
  for (const character of source) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `p_${(hash >>> 0).toString(36)}`;
}

export function scanPage(document: Document, window: Window, registry: ElementRegistry): PageState {
  registry.beginGeneration();
  const limitations: string[] = [];
  const elements: ElementRef[] = [];
  const elementRefs = new Map<HTMLElement, string>();
  const candidates = collectInteractiveElements(document);
  if (Array.from(document.querySelectorAll<HTMLElement>("*")).some((element) => element.tagName.includes("-") && !element.shadowRoot)) {
    limitations.push("custom_elements_may_use_unavailable_closed_shadow_roots");
  }

  for (const element of candidates) {
    if (!isElementVisible(element, window)) continue;
    const ref = registry.register(element);
    elementRefs.set(element, ref);
    elements.push(toElementRef(element, ref, document, window));
  }

  const scrollContainers: ScrollContainerRef[] = [];
  for (const element of collectScrollableElements(document).slice(0, 20)) {
    const ref = registry.register(element);
    const rect = element.getBoundingClientRect();
    scrollContainers.push({
      ref,
      label: element.getAttribute("aria-label") || element.id || element.getAttribute("role") || element.tagName.toLowerCase(),
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      scrollSnapType: window.getComputedStyle(element).scrollSnapType !== "none" ? window.getComputedStyle(element).scrollSnapType : undefined,
      context: getElementContext(element, document),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    });
  }

  const stateWithoutFingerprint = {
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    },
    pageTextSummary: summarizePageText(document),
    regions: collectRegions(document, document, window),
    elements,
    focusedElement: (() => {
      const active = getDeepActiveElement(document);
      return active ? elementRefs.get(active) : undefined;
    })(),
    activeDialog: (() => {
      const active = Array.from(document.querySelectorAll<HTMLElement>("dialog[open],[role=dialog]"))
        .find((dialog) => isElementVisible(dialog, window));
      return active ? regionName(active, document) ?? regionKind(active) : undefined;
    })(),
    embeddedFrames: Array.from(document.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>("iframe,frame")).slice(0, 30).map((frame) => ({
      title: compactText(frame.getAttribute("title") || frame.getAttribute("aria-label") || "", 100) || undefined,
      url: safeFrameUrl(frame),
      sandboxed: frame instanceof HTMLIFrameElement && frame.hasAttribute("sandbox"),
      loading: frame instanceof HTMLIFrameElement ? frame.loading : undefined,
    })),
    scrollLocked: (() => {
      const rootStyle = window.getComputedStyle(document.documentElement);
      const bodyStyle = document.body ? window.getComputedStyle(document.body) : undefined;
      return [rootStyle.overflowY, rootStyle.overflow, bodyStyle?.overflowY, bodyStyle?.overflow]
        .some((value) => /hidden|clip/.test(value ?? ""));
    })(),
    scrollContainers,
    limitations: [...new Set(limitations)],
  };
  return { ...stateWithoutFingerprint, fingerprint: fingerprint(stateWithoutFingerprint) };
}
