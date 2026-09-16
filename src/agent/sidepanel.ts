interface ScanResponse {
  ok: boolean;
  data?: { title: string; url: string };
  error?: string;
}

function requestId(): string {
  return crypto.randomUUID();
}

export function initSidePanel(chromeApi: typeof chrome): void {
  const status = document.querySelector<HTMLElement>("#status");
  const pageState = document.querySelector<HTMLElement>("#page-state");
  if (!status || !pageState) return;

  status.textContent = "Inspecionando a página ativa…";
  chromeApi.runtime.sendMessage({ type: "SCAN_PAGE", requestId: requestId() }, (response: ScanResponse | undefined) => {
    if (chromeApi.runtime.lastError || !response?.ok || !response.data) {
      status.textContent = response?.error ?? "Não foi possível inspecionar esta página.";
      return;
    }
    status.textContent = "Página conectada";
    pageState.textContent = `${response.data.title || "Sem título"} — ${response.data.url}`;
  });
}
