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
  const actionRef = document.querySelector<HTMLInputElement>("#action-ref");
  const actionText = document.querySelector<HTMLInputElement>("#action-text");
  const actionResult = document.querySelector<HTMLOutputElement>("#action-result");
  const clickButton = document.querySelector<HTMLButtonElement>("#action-click");
  const typeButton = document.querySelector<HTMLButtonElement>("#action-type");
  if (!status || !pageState || !elements || !debugOverlay || !actionRef || !actionText || !actionResult || !clickButton || !typeButton) return;

  const sendAction = (action: unknown): void => {
    actionResult.textContent = "Executando…";
    void chromeApi.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab.id === undefined) throw new Error("Aba ativa indisponível");
      return chromeApi.tabs.sendMessage(tab.id, { type: "EXECUTE_ACTION", actionId: requestId(), action });
    }).then((response: { ok?: boolean; code?: string; error?: string } | undefined) => {
      actionResult.textContent = response?.ok ? "Ação executada" : `${response?.code ?? "ERRO"}: ${response?.error ?? "falha"}`;
    }).catch((error: unknown) => { actionResult.textContent = error instanceof Error ? error.message : "Falha ao executar ação"; });
  };
  clickButton.addEventListener("click", () => sendAction({ type: "click", target: { ref: actionRef.value.trim() } }));
  typeButton.addEventListener("click", () => sendAction({ type: "type", target: { ref: actionRef.value.trim() }, text: actionText.value, replace: true }));

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
