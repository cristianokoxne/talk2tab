const whitespace = /\s+/g;

export function compactText(value: string, maximumLength = 160): string {
  const compacted = value.replace(whitespace, " ").trim();
  return compacted.length <= maximumLength ? compacted : `${compacted.slice(0, maximumLength - 1)}…`;
}

export function summarizePageText(document: Document): string {
  if (!document.body) return "";
  const body = document.body.cloneNode(true) as HTMLElement;
  body.querySelector("#voice-browser-agent-debug-overlay")?.remove();
  return compactText(body.innerText ?? body.textContent ?? "", 500);
}
