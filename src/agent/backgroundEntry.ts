import { initAgentOrchestrator } from "./orchestrator.js";

const orchestrator = initAgentOrchestrator(chrome);

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
