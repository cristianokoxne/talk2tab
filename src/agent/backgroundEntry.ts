import { initAgentOrchestrator } from "./orchestrator.js";

function startMainWorldSpeechRecognition(): void {
  type Recognition = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onend: (() => void) | null;
    onerror: ((event: Event & { error?: string }) => void) | null;
    onresult: ((event: Event & { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } }) => void) | null;
    start(): void;
    stop(): void;
  };
  const page = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition; __talk2tabRecognition?: Recognition; __talk2tabFinalText?: string };
  const Constructor = page.SpeechRecognition ?? page.webkitSpeechRecognition;
  const emit = (message: { type: string; text?: string; status?: string }): void => {
    const payload = { source: "talk2tab", ...message };
    window.postMessage(payload, "*");
    document.dispatchEvent(new CustomEvent("talk2tab-speech", { detail: payload }));
  };
  if (!Constructor) { emit({ type: "PAGE_SPEECH_STATUS", status: "SpeechRecognition não está disponível nesta página." }); return; }
  const recognition = new Constructor();
  page.__talk2tabRecognition = recognition;
  page.__talk2tabFinalText = "";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "pt-BR";
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) page.__talk2tabFinalText += `${text} `;
      else interim += text;
    }
    emit({ type: "PAGE_SPEECH_RESULT", text: `${page.__talk2tabFinalText}${interim}`.trim() });
  };
  recognition.onerror = (event) => emit({ type: "PAGE_SPEECH_STATUS", status: `Erro do reconhecimento: ${event.error ?? "desconhecido"}.` });
  recognition.onend = () => {
    if (page.__talk2tabRecognition !== recognition) return;
    try { recognition.start(); } catch { /* O Chrome já pode estar reiniciando. */ }
  };
  try { recognition.start(); emit({ type: "PAGE_SPEECH_STATUS", status: "Reconhecimento iniciado na página ativa." }); }
  catch (error) { emit({ type: "PAGE_SPEECH_STATUS", status: error instanceof Error ? error.message : "Não foi possível iniciar o reconhecimento." }); }
}

function stopMainWorldSpeechRecognition(): void {
  const page = window as Window & { __talk2tabRecognition?: { stop(): void } };
  page.__talk2tabRecognition?.stop();
  delete page.__talk2tabRecognition;
}

const orchestrator = initAgentOrchestrator(chrome);

// A API key é usada pelo service worker, não pelos content scripts.
// Este nível restringe o storage local aos contextos confiáveis da extensão.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.storage.local.set({ initialized: true });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) {
    void chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "START_PAGE_SPEECH_MAIN") {
    void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab.id === undefined) throw new Error("Aba ativa indisponível.");
      return chrome.scripting.executeScript({ target: { tabId: tab.id, world: "MAIN" } as unknown as chrome.scripting.InjectionTarget, func: startMainWorldSpeechRecognition });
    }).then(() => {
      void chrome.runtime.sendMessage({ type: "PAGE_SPEECH_STATUS", status: "Script de reconhecimento injetado na página." });
      sendResponse({ ok: true });
    }).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Não foi possível iniciar na página." }));
    return true;
  }
  if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "STOP_PAGE_SPEECH_MAIN") {
    void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab.id === undefined) throw new Error("Aba ativa indisponível.");
      return chrome.scripting.executeScript({ target: { tabId: tab.id, world: "MAIN" } as unknown as chrome.scripting.InjectionTarget, func: stopMainWorldSpeechRecognition });
    }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "OPEN_MIC_PERMISSION") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("microphone-permission.html"), active: true })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "Não foi possível abrir a tela de permissão do microfone." }));
    return true;
  }
  if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "MIC_PERMISSION_RESULT") {
    const result = message as { ok?: boolean; error?: string };
    if (sender.tab?.id !== undefined) void chrome.tabs.remove(sender.tab.id);
    void chrome.runtime.sendMessage({ type: "MIC_PERMISSION_RESULT", ok: result.ok === true, error: result.error });
    sendResponse({ ok: true });
    return true;
  }
  orchestrator.handleMessage(message, sender, sendResponse);
  return true;
});
