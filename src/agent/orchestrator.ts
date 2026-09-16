export interface ScanPageMessage {
  type: "SCAN_PAGE";
  requestId: string;
}

interface ContentScanResponse {
  ok: boolean;
  requestId: string;
  data?: { title: string; url: string };
}

function isScanPageMessage(value: unknown): value is ScanPageMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "SCAN_PAGE" && typeof message.requestId === "string";
}

export function initAgentOrchestrator(chromeApi: typeof chrome) {
  return {
    handleMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): void {
      if (!isScanPageMessage(message)) {
        sendResponse({ ok: false, code: "UNSUPPORTED_MESSAGE", error: "Unsupported message." });
        return;
      }

      void resolveTabId(chromeApi, sender).then((tabId) => {
        if (tabId === undefined) {
          sendResponse({ ok: false, code: "TAB_UNAVAILABLE", error: "No active tab is available." });
          return;
        }
        return chromeApi.tabs.sendMessage(tabId, { type: "PAGE_SCAN_REQUEST", requestId: message.requestId });
      })
        .then((response: ContentScanResponse | undefined) => {
          if (!response?.ok || !response.data) {
            sendResponse({ ok: false, code: "CONTENT_SCRIPT_UNAVAILABLE", error: "Could not inspect this page." });
            return;
          }
          sendResponse({ ok: true, data: response.data });
        })
        .catch(() => sendResponse({ ok: false, code: "CONTENT_SCRIPT_UNAVAILABLE", error: "Could not inspect this page." }));
    },
  };
}

async function resolveTabId(chromeApi: typeof chrome, sender: chrome.runtime.MessageSender): Promise<number | undefined> {
  if (sender.tab?.id !== undefined) return sender.tab.id;
  const [activeTab] = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
  return activeTab?.id;
}
