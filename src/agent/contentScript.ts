import { ElementRegistry } from "./registry/elementRegistry.js";
import { scanPage } from "./scanner/pageScanner.js";
import { removeDebugOverlay, showDebugOverlay } from "./overlay/debugOverlay.js";
import { executeClick } from "./executor/click.js";
import { executeType } from "./executor/type.js";
import { executeSelect } from "./executor/select.js";

interface ScanRequest {
  type: "PAGE_SCAN_REQUEST";
  requestId: string;
}

interface OverlayRequest { type: "SCANNER_OVERLAY"; enabled: boolean; }
type ExecuteActionRequest =
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "click"; target: { ref: string } } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "type"; target: { ref: string }; text: string; replace?: boolean } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "select"; target: { ref: string }; value: string } };

function isScanRequest(value: unknown): value is ScanRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "PAGE_SCAN_REQUEST" && typeof message.requestId === "string";
}

export function initContentScript(chromeApi: typeof chrome, document: Document, window: Window): void {
  const registry = new ElementRegistry();
  let latestState: ReturnType<typeof scanPage> | undefined;
  chromeApi.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isScanRequest(message)) {
      latestState = scanPage(document, window, registry);
      sendResponse({ ok: true, requestId: message.requestId, data: latestState });
      return;
    }
    if (typeof message === "object" && message !== null && (message as OverlayRequest).type === "SCANNER_OVERLAY") {
      const request = message as OverlayRequest;
      if (request.enabled && latestState) showDebugOverlay(document, registry, latestState.elements);
      else removeDebugOverlay(document);
      sendResponse({ ok: true });
      return;
    }
    if (typeof message === "object" && message !== null && (message as ExecuteActionRequest).type === "EXECUTE_ACTION") {
      const request = message as ExecuteActionRequest;
      if (request.action?.type === "type") {
        if (typeof request.actionId !== "string" || typeof request.action.target?.ref !== "string" || typeof request.action.text !== "string") {
          sendResponse({ ok: false, code: "INVALID_ACTION", error: "Invalid type action." });
          return;
        }
        sendResponse(executeType(request.actionId, registry, request.action.target.ref, request.action.text, request.action.replace));
        return;
      }
      if (request.action?.type === "select") {
        if (typeof request.actionId !== "string" || typeof request.action.target?.ref !== "string" || typeof request.action.value !== "string") {
          sendResponse({ ok: false, code: "INVALID_ACTION", error: "Invalid select action." });
          return;
        }
        sendResponse(executeSelect(request.actionId, registry, request.action.target.ref, request.action.value));
        return;
      }
      if (request.action?.type !== "click" || typeof request.actionId !== "string" || typeof request.action.target?.ref !== "string") {
        sendResponse({ ok: false, code: "INVALID_ACTION", error: "Invalid click action." });
        return;
      }
      sendResponse(executeClick(request.actionId, registry, request.action.target.ref));
    }
  });
}
