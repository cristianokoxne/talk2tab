import type { PageState } from "./types.js";

interface ScanResponse {
  ok: boolean;
  data?: PageState;
  error?: string;
}

function requestId(): string {
  return crypto.randomUUID();
}

export function initSidePanel(chromeApi: typeof chrome): void {
  const status = document.querySelector<HTMLElement>("#status");
  const pageState = document.querySelector<HTMLElement>("#page-state");
  const elements = document.querySelector<HTMLUListElement>("#elements");
  const debugOverlay = document.querySelector<HTMLInputElement>("#debug-overlay");
  if (!status || !pageState || !elements || !debugOverlay) return;

  debugOverlay.addEventListener("change", () => {
    void chromeApi.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab.id !== undefined) void chromeApi.tabs.sendMessage(tab.id, { type: "SCANNER_OVERLAY", enabled: debugOverlay.checked });
    });
  });

  status.textContent = "Inspecionando a página ativa…";
  chromeApi.runtime.sendMessage({ type: "SCAN_PAGE", requestId: requestId() }, (response: ScanResponse | undefined) => {
    if (chromeApi.runtime.lastError || !response?.ok || !response.data) {
      status.textContent = response?.error ?? "Não foi possível inspecionar esta página.";
      return;
    }
    status.textContent = "Página conectada";
    pageState.textContent = `${response.data.title || "Sem título"} — ${response.data.url}`;
    elements.replaceChildren(...response.data.elements.map((element) => {
      const item = document.createElement("li");
      const ref = document.createElement("code");
      ref.textContent = element.ref;
      item.append(ref, document.createTextNode(` ${element.role ?? element.tag}: ${element.name ?? element.text ?? "sem nome"}`));
      return item;
    }));
  });
}
