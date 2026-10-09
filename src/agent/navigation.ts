import type { PageState } from "./types.js";

export interface TabIdentity { id: number; openerTabId?: number; }

export function validateNavigationUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("URL inválida."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error("Só é permitido navegar para URLs HTTP ou HTTPS sem credenciais embutidas.");
  }
  return url.toString();
}

export function isRestrictedDocumentUrl(url: string): boolean {
  return /^(?:chrome|chrome-untrusted|edge|about|devtools|chrome-extension|file):/i.test(url);
}

export function makeUninspectablePage(url: string, title: string): PageState {
  return {
    url, title, viewport: { width: 0, height: 0, scrollY: 0 }, pageTextSummary: "",
    fingerprint: `uninspectable:${url}`, elements: [], limitations: ["UNINSPECTABLE_DOCUMENT"],
  };
}

export function findSpawnedChildTab(tabs: TabIdentity[], knownTabIds: Set<number>, openerTabId: number): number | undefined {
  return tabs.find((tab) => !knownTabIds.has(tab.id) && tab.openerTabId === openerTabId)?.id;
}
