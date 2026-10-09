import { compactText } from "./text.js";

type AccessibleRoot = Document | ShadowRoot;

function rootFor(element: HTMLElement, document: Document): AccessibleRoot {
  const root = element.getRootNode();
  return root.nodeType === 11 && "getElementById" in root ? root as ShadowRoot : document;
}

function labelledByText(element: HTMLElement, root: AccessibleRoot): string {
  return (element.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => root.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function associatedLabel(element: HTMLElement, root: AccessibleRoot): string {
  if (element.id) {
    const label = Array.from(root.querySelectorAll<HTMLLabelElement>("label[for]")).find((candidate) => candidate.htmlFor === element.id);
    if (label?.textContent) return label.textContent;
  }
  return element.closest("label")?.textContent ?? "";
}

export function getAccessibleName(element: HTMLElement, document: Document): string {
  const root = rootFor(element, document);
  const candidates = [
    element.getAttribute("aria-label"), labelledByText(element, root), associatedLabel(element, root),
    element.getAttribute("alt"), element.getAttribute("title"), element.getAttribute("placeholder"),
    element.innerText, element.textContent, element.getAttribute("name"), element.id,
  ];
  return compactText(candidates.find((candidate) => candidate?.trim()) ?? "", 160);
}

export function getAccessibleDescription(element: HTMLElement, document: Document): string | undefined {
  const root = rootFor(element, document);
  const describedBy = (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => root.getElementById(id)?.textContent ?? "")
    .filter(Boolean)
    .join(" ");
  return compactText(describedBy || element.getAttribute("title") || "", 240) || undefined;
}

export function inferRole(element: HTMLElement): string | undefined {
  const explicitRole = element.getAttribute("role");
  if (explicitRole) return explicitRole;
  if (element.isContentEditable) return "textbox";
  switch (element.tagName.toLowerCase()) {
    case "a": return "link";
    case "button": return "button";
    case "textarea": return "textbox";
    case "select": return "combobox";
    case "input": {
      const type = (element as HTMLInputElement).type;
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "search") return "searchbox";
      if (["button", "submit", "reset"].includes(type)) return "button";
      return "textbox";
    }
    default: return undefined;
  }
}
