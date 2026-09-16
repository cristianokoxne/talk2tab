interface ScanRequest {
  type: "PAGE_SCAN_REQUEST";
  requestId: string;
}

function isScanRequest(value: unknown): value is ScanRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "PAGE_SCAN_REQUEST" && typeof message.requestId === "string";
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isScanRequest(message)) return;

  sendResponse({
    ok: true,
    requestId: message.requestId,
    data: { title: document.title, url: location.href },
  });
});
