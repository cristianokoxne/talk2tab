const whitespace = /\s+/g;

export function compactText(value: string, maximumLength = 160): string {
  const compacted = value.replace(whitespace, " ").trim();
  return compacted.length <= maximumLength ? compacted : `${compacted.slice(0, maximumLength - 1)}…`;
}

export function summarizePageText(document: Document): string {
  return compactText(document.body?.innerText ?? "", 500);
}
