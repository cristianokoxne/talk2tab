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

interface OverlayRequest { type: "SCANNER_OVERLAY"; enabled: boolean; }
type ExecuteActionRequest =
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "click"; target: { ref: string } } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "type"; target: { ref: string }; text: string; replace?: boolean } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "select"; target: { ref: string }; value: string } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "scroll"; direction: "up" | "down"; amount: "viewport" | number; target?: { ref: string } } }
  | { type: "EXECUTE_ACTION"; actionId: string; action: { type: "keypress"; key: string } };

function isScanRequest(value: unknown): value is ScanRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "PAGE_SCAN_REQUEST" && typeof message.requestId === "string";
}

export function initContentScript(chromeApi: typeof chrome, document: Document, window: Window): void {
  const registry = new ElementRegistry();
  let latestState: ReturnType<typeof scanPage> | undefined;
  const startPageSpeech = (): void => {
    void chromeApi.runtime.sendMessage({ type: "PAGE_SPEECH_STATUS", status: "Content script recebeu o comando." });
    void chromeApi.runtime.sendMessage({ type: "START_PAGE_SPEECH_MAIN" });
  };
  const stopPageSpeech = (): void => {
    void chromeApi.runtime.sendMessage({ type: "PAGE_SPEECH_STATUS", status: "Parando reconhecimento na página." });
    void chromeApi.runtime.sendMessage({ type: "STOP_PAGE_SPEECH_MAIN" });
  };
  window.addEventListener("message", (event: MessageEvent) => {
    // Em content scripts isolados, o wrapper de `window` pode ser diferente
    // do wrapper usado pelo mundo principal. Valide a assinatura da mensagem,
    // mas não compare event.source com window.
    if (typeof event.data !== "object" || event.data?.source !== "talk2tab") return;
    if (event.data.type === "PAGE_SPEECH_RESULT" || event.data.type === "PAGE_SPEECH_STATUS") void chromeApi.runtime.sendMessage(event.data);
  });
  document.addEventListener("talk2tab-speech", (event: Event) => {
    const detail = (event as CustomEvent<{ source?: string; type?: string; text?: string; status?: string }>).detail;
    if (detail?.source !== "talk2tab") return;
    if (detail.type === "PAGE_SPEECH_RESULT" || detail.type === "PAGE_SPEECH_STATUS") void chromeApi.runtime.sendMessage(detail);
  });
  chromeApi.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "START_PAGE_SPEECH") {
      startPageSpeech();
      sendResponse({ ok: true });
      return;
    }
    if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "STOP_PAGE_SPEECH") {
      stopPageSpeech();
      sendResponse({ ok: true, text: "" });
      return;
    }
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
      if (request.action?.type === "scroll") {
        if (typeof request.actionId !== "string" || !["up", "down"].includes(request.action.direction) || (request.action.amount !== "viewport" && typeof request.action.amount !== "number")) {
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
