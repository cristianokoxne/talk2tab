import { ElementRegistry } from "./registry/elementRegistry.js";
import { scanPage } from "./scanner/pageScanner.js";
import { removeDebugOverlay, showDebugOverlay } from "./overlay/debugOverlay.js";
import { executeClick } from "./executor/click.js";
import { executeType } from "./executor/type.js";
import { executeSelect } from "./executor/select.js";
import { executeScroll } from "./executor/scroll.js";
import { executeKeyPress } from "./executor/keypress.js";

interface ScanRequest {
  type: "PAGE_SCAN_REQUEST";
  requestId: string;
}

interface OverlayRequest { type: "SCANNER_OVERLAY"; enabled: boolean; frameId?: number; }
type ExecuteActionRequest =
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "click"; target: { ref: string } } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "type"; target: { ref: string }; text: string; replace?: boolean } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "select"; target: { ref: string }; value: string } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "scroll"; direction: "up" | "down" | "left" | "right" | "top" | "bottom"; amount: "viewport" | number; target?: { ref: string } } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "keypress"; key: string } };

function isScanRequest(value: unknown): value is ScanRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "PAGE_SCAN_REQUEST" && typeof message.requestId === "string";
}

export function initContentScript(chromeApi: typeof chrome, document: Document, window: Window): void {
  const documentPrefix = `doc_${Math.random().toString(36).slice(2, 10)}`;
  const registry = new ElementRegistry(documentPrefix);
  let latestState: ReturnType<typeof scanPage> | undefined;
  let overlayEnabled = false;
  let overlayRefPrefix = "";
  chromeApi.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isScanRequest(message)) {
      latestState = scanPage(document, window, registry);
      if (overlayEnabled) showDebugOverlay(document, registry, latestState.elements, latestState.scrollContainers, overlayRefPrefix);
      sendResponse({ ok: true, requestId: message.requestId, data: latestState });
      return;
    }
    if (typeof message === "object" && message !== null && (message as OverlayRequest).type === "SCANNER_OVERLAY") {
      const request = message as OverlayRequest;
      overlayEnabled = request.enabled;
      overlayRefPrefix = Number.isInteger(request.frameId) ? `fr${request.frameId}__` : "";
      if (overlayEnabled) {
        latestState ??= scanPage(document, window, registry);
        const markerCount = showDebugOverlay(document, registry, latestState.elements, latestState.scrollContainers, overlayRefPrefix);
        sendResponse({ ok: true, markerCount });
      } else removeDebugOverlay(document);
      if (!overlayEnabled) sendResponse({ ok: true, markerCount: 0 });
      return;
    }
    if (typeof message === "object" && message !== null && (message as ExecuteActionRequest).type === "EXECUTE_ACTION") {
      const request = message as ExecuteActionRequest;
      if (request.action?.type === "type") {
        if (typeof request.actionId !== "string" || typeof request.action.target?.ref !== "string" || typeof request.action.text !== "string") {
          sendResponse({ ok: false, code: "INVALID_ACTION", error: "Invalid type action." });
          return;
        }
        void executeType(request.actionId, registry, request.action.target.ref, request.action.text, request.action.replace)
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, actionId: request.actionId, status: "failed", code: "INPUT_EXECUTION_FAILED", error: "Unable to verify the field update." }));
        return true;
      }
      if (request.action?.type === "select") {
        if (typeof request.actionId !== "string" || typeof request.action.target?.ref !== "string" || typeof request.action.value !== "string") {
          sendResponse({ ok: false, code: "INVALID_ACTION", error: "Invalid select action." });
          return;
        }
        void executeSelect(request.actionId, registry, request.action.target.ref, request.action.value)
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, actionId: request.actionId, status: "failed", code: "SELECTION_FAILED", error: "Unable to verify the selected option." }));
        return true;
      }
      if (request.action?.type === "scroll") {
        if (typeof request.actionId !== "string" || !["up", "down", "left", "right", "top", "bottom"].includes(request.action.direction) || (request.action.amount !== "viewport" && typeof request.action.amount !== "number")) {
          sendResponse({ ok: false, code: "INVALID_ACTION", error: "Invalid scroll action." });
          return;
        }
        const target = request.action.target?.ref ? registry.get(request.action.target.ref) : undefined;
        if (request.action.target?.ref && !target) {
          sendResponse({ ok: false, actionId: request.actionId, status: "failed", code: "STALE_SCROLL_CONTAINER", error: "O contêiner de rolagem ficou obsoleto." });
          return;
        }
        sendResponse(executeScroll(request.actionId, window, request.action, target));
        return;
      }
      if (request.action?.type === "keypress") {
        if (typeof request.actionId !== "string" || typeof request.action.key !== "string") {
          sendResponse({ ok: false, code: "INVALID_ACTION", error: "Invalid keypress action." });
          return;
        }
        sendResponse(executeKeyPress(request.actionId, document, request.action.key));
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
