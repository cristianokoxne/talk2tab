const whitespace = /\s+/g;

export function compactText(value: string, maximumLength = 160): string {
  const compacted = value.replace(whitespace, " ").trim();
  return compacted.length <= maximumLength ? compacted : `${compacted.slice(0, maximumLength - 1)}…`;
}

export function summarizePageText(document: Document): string {
  if (!document.body) return "";
  const body = document.body.cloneNode(true) as HTMLElement;
  body.querySelector("#voice-browser-agent-debug-overlay")?.remove();
  const selectors = "main,[role=main],nav,[role=navigation],[role=dialog],form,[role=alert],[role=status],section,article,h1,h2,h3";
  const regions = Array.from(body.querySelectorAll<HTMLElement>(selectors)).map((element) => {
    const kind = element.matches("[role=dialog]") ? "dialog"
      : element.matches("form") ? "form"
        : element.matches("nav,[role=navigation]") ? "navigation"
          : element.matches("[role=alert]") ? "alert"
            : element.matches("[role=status]") ? "status"
              : element.matches("main,[role=main]") ? "main"
                : element.tagName.toLowerCase();
    const heading = element.matches("h1,h2,h3") ? "" : element.querySelector("h1,h2,h3")?.textContent ?? "";
    const name = element.getAttribute("aria-label") || heading;
    const text = compactText(element.innerText ?? element.textContent ?? "", 260);
    return { kind, name: compactText(name, 100), text };
  }).filter((region) => region.text.length > 0);
  const priority = (kind: string): number => ({ dialog: 0, alert: 1, status: 1, main: 2, form: 3, navigation: 4 }[kind] ?? 5);
  const deduplicated = [...new Map(regions.sort((a, b) => priority(a.kind) - priority(b.kind)).map((region) => [`${region.kind}|${region.name}|${region.text}`, region])).values()];
  if (deduplicated.length === 0) return compactText(body.innerText ?? body.textContent ?? "", 500);
  return compactText(deduplicated.slice(0, 10).map(({ kind, name, text }) => `${kind}${name ? ` ${name}` : ""}: ${text}`).join(" | "), 1600);
}
