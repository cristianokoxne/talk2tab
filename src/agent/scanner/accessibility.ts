import { compactText } from "./text.js";

function labelledByText(element: HTMLElement, document: Document): string {
  return (element.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function associatedLabel(element: HTMLElement, document: Document): string {
  if (element.id) {
    const label = Array.from(document.querySelectorAll<HTMLLabelElement>("label[for]")).find((candidate) => candidate.htmlFor === element.id);
    if (label?.textContent) return label.textContent;
  }
  return element.closest("label")?.textContent ?? "";
}

export function getAccessibleName(element: HTMLElement, document: Document): string {
  const candidates = [
    element.getAttribute("aria-label"), labelledByText(element, document), associatedLabel(element, document),
    element.getAttribute("alt"), element.getAttribute("title"), element.getAttribute("placeholder"),
    element.innerText, element.getAttribute("name"), element.id,
  ];
  return compactText(candidates.find((candidate) => candidate?.trim()) ?? "", 160);
}

export function inferRole(element: HTMLElement): string | undefined {
  const explicitRole = element.getAttribute("role");
  if (explicitRole) return explicitRole;
  switch (element.tagName.toLowerCase()) {
    case "a": return "link";
    case "button": return "button";
    case "textarea": return "textbox";
    case "select": return "combobox";
    case "input": {
      const type = (element as HTMLInputElement).type;
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["button", "submit", "reset"].includes(type)) return "button";
      return "textbox";
    }
    default: return undefined;
  }
}
