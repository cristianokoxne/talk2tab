import { initAgentOrchestrator } from "./orchestrator.js";

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
  orchestrator.handleMessage(message, sender, sendResponse);
  return true;
});
