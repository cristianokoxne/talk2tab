import type { ActionResult, PageState, ProviderConfig } from "./types.js";
import { buildJevCommandMap } from "./provider/commandMap.js";
import type { BrowserTabSummary } from "./provider/commandMap.js";
import { JevProvider } from "./provider/jev.js";
import { runAgentLoop } from "./loop.js";
import { verifyAction } from "./verification.js";

const activeRuns = new Map<string, AbortController>();

export interface ScanPageMessage {
  type: "SCAN_PAGE";
  requestId: string;
}

export interface RunAgentMessage {
  type: "RUN_AGENT";
  requestId: string;
  goal: string;
}

export interface CancelAgentMessage {
  type: "CANCEL_AGENT";
  requestId: string;
}

export interface AgentPageStateMessage {
  type: "AGENT_PAGE_STATE";
  requestId: string;
  step: number;
  tabId: number;
  data: PageState;
}

interface ContentScanResponse {
  ok: boolean;
  requestId: string;
  data?: PageState;
}

function isContinuousScrollGoal(goal: string): boolean {
  return /\b(scrolle|scroll|role|rolar|rolando)\b/i.test(goal)
    && /\b(devagar|lentamente|continuamente|at[eé]\s+eu\s+mandar\s+parar|at[eé]\s+eu\s+mandar\s+parar)\b/i.test(goal);
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); resolve(); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isScanPageMessage(value: unknown): value is ScanPageMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "SCAN_PAGE" && typeof message.requestId === "string";
}

function isRunAgentMessage(value: unknown): value is RunAgentMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "RUN_AGENT" && typeof message.requestId === "string" && typeof message.goal === "string" && message.goal.trim().length > 0;
}

function isCancelAgentMessage(value: unknown): value is CancelAgentMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "CANCEL_AGENT" && typeof message.requestId === "string";
}

async function scanTab(chromeApi: typeof chrome, tabId: number, requestId: string): Promise<PageState> {
  let response: ContentScanResponse | undefined;
  try {
    response = await chromeApi.tabs.sendMessage(tabId, { type: "PAGE_SCAN_REQUEST", requestId }) as ContentScanResponse | undefined;
  } catch {
    await chromeApi.scripting.executeScript({ target: { tabId }, files: ["contentScript.js"] });
    response = await chromeApi.tabs.sendMessage(tabId, { type: "PAGE_SCAN_REQUEST", requestId }) as ContentScanResponse | undefined;
  }
  if (!response?.ok || !response.data) throw new Error("Could not inspect this page.");
  return response.data;
}

async function listTabs(chromeApi: typeof chrome): Promise<BrowserTabSummary[]> {
  const tabs = await chromeApi.tabs.query({});
  return tabs.flatMap((tab) => tab.id === undefined || tab.windowId === undefined ? [] : [{ id: tab.id, title: tab.title ?? "", url: tab.url ?? "", active: Boolean(tab.active), windowId: tab.windowId }]);
}

async function waitForTabLoaded(chromeApi: typeof chrome, tabId: number): Promise<void> {
  const tab = await chromeApi.tabs.get(tabId);
  if (tab.status === "complete") return;
  await new Promise<void>((resolve) => {
    const listener = (updatedTabId: number, info: { status?: string }): void => {
      if (updatedTabId !== tabId || info.status !== "complete") return;
      chromeApi.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chromeApi.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chromeApi.tabs.onUpdated.removeListener(listener); resolve(); }, 10000);
  });
}

async function syncActiveTab(chromeApi: typeof chrome, currentTabId: { value: number }): Promise<void> {
  const [active] = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id === undefined || active.id === currentTabId.value) return;
  currentTabId.value = active.id;
  await waitForTabLoaded(chromeApi, active.id);
}

async function executeBrowserAction(chromeApi: typeof chrome, action: import("./types.js").BrowserAction, currentTabId: { value: number }): Promise<ActionResult> {
  if (action.type === "navigate") {
    await chromeApi.tabs.update(currentTabId.value, { url: action.url, active: true });
    await waitForTabLoaded(chromeApi, currentTabId.value);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "search_web") {
    const url = `https://www.google.com/search?q=${encodeURIComponent(action.query)}`;
    await chromeApi.tabs.update(currentTabId.value, { url, active: true });
    await waitForTabLoaded(chromeApi, currentTabId.value);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "open_tab") {
    const tab = await chromeApi.tabs.create({ url: action.url, active: true });
    if (tab.id === undefined) throw new Error("Não foi possível criar a nova aba.");
    currentTabId.value = tab.id;
    await waitForTabLoaded(chromeApi, tab.id);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "open_window") {
    const created = await chromeApi.windows.create({ url: action.url, focused: true, type: "normal" });
    if (!created) throw new Error("Não foi possível criar a nova janela.");
    const tabId = created.tabs?.[0]?.id;
    if (tabId === undefined) throw new Error("Não foi possível criar a nova janela.");
    currentTabId.value = tabId;
    await waitForTabLoaded(chromeApi, tabId);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "switch_tab") {
    await chromeApi.tabs.update(action.tabId, { active: true });
    const tab = await chromeApi.tabs.get(action.tabId);
    currentTabId.value = action.tabId;
    if (tab.windowId !== undefined) await chromeApi.windows.update(tab.windowId, { focused: true });
    await waitForTabLoaded(chromeApi, action.tabId);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "close_tab") {
    await chromeApi.tabs.remove(action.tabId);
    const [next] = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
    if (next?.id === undefined) throw new Error("Não há outra aba ativa disponível.");
    currentTabId.value = next.id;
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  throw new Error("Ação de navegador não suportada.");
}

async function loadProviderConfig(chromeApi: typeof chrome): Promise<ProviderConfig> {
  const stored = await chromeApi.storage.local.get("jevProvider");
  return {
    id: "jev",
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    ...(stored.jevProvider as Partial<ProviderConfig> | undefined),
  };
}

function publishPageState(chromeApi: typeof chrome, requestId: string, step: number, tabId: number, data: PageState): void {
  try {
    void chromeApi.runtime.sendMessage({ type: "AGENT_PAGE_STATE", requestId, step, tabId, data }).catch(() => undefined);
  } catch {
    // The side panel may be closed while the agent continues running.
  }
}

async function runAgent(chromeApi: typeof chrome, tabId: number, message: RunAgentMessage, signal: AbortSignal): Promise<unknown> {
  if (isContinuousScrollGoal(message.goal)) return runContinuousScroll(chromeApi, tabId, message, signal);
  const config = await loadProviderConfig(chromeApi);
  const provider = new JevProvider(config);
  const currentTabId = { value: tabId };
  const completedActions = new Set<string>();
  let observationStep = 0;
  return runAgentLoop({
    observe: async () => {
      const page = await scanTab(chromeApi, currentTabId.value, message.requestId);
      observationStep += 1;
      publishPageState(chromeApi, message.requestId, observationStep, currentTabId.value, page);
      return page;
    },
    decide: async (page) => {
      const { map, options } = buildJevCommandMap(message.goal, page, await listTabs(chromeApi), [...completedActions]);
      return provider.chooseNextAction(map, options);
    },
    execute: async (action, actionId) => {
      if (["navigate", "search_web", "open_tab", "open_window", "switch_tab", "close_tab"].includes(action.type)) {
        const result = await executeBrowserAction(chromeApi, action as import("./types.js").BrowserAction, currentTabId);
        completedActions.add(action.type);
        result.actionId = actionId;
        return result;
      }
      const result = await chromeApi.tabs.sendMessage(currentTabId.value, { type: "EXECUTE_ACTION", actionId, action }) as ActionResult;
      completedActions.add(action.type);
      await syncActiveTab(chromeApi, currentTabId);
      await waitForTabLoaded(chromeApi, currentTabId.value);
      return result;
    },
    verify: verifyAction,
  }, 8, signal);
}

async function runContinuousScroll(chromeApi: typeof chrome, tabId: number, message: RunAgentMessage, signal: AbortSignal): Promise<unknown> {
  const currentTabId = { value: tabId };
  const direction = /\b(cima|suba|volte)\b/i.test(message.goal) ? "up" : "down";
  const steps: Array<{ step: number; action: import("./types.js").BrowserAction; result: ActionResult }> = [];
  let step = 0;
  while (!signal.aborted) {
    const page = await scanTab(chromeApi, currentTabId.value, message.requestId);
    step += 1;
    publishPageState(chromeApi, message.requestId, step, currentTabId.value, page);
    const action = { type: "scroll", direction, amount: 180, target: page.scrollContainers?.[0]?.ref ? { ref: page.scrollContainers[0].ref } : undefined } as const;
    const result = await chromeApi.tabs.sendMessage(currentTabId.value, { type: "EXECUTE_ACTION", actionId: `continuous_scroll_${step}`, action }) as ActionResult;
    steps.push({ step, action, result });
    if (!result.ok) return { status: "failed", steps, message: result.error ?? "Não foi possível continuar rolando." };
    await waitWithAbort(700, signal);
  }
  return { status: "cancelled", steps, message: "Rolagem contínua interrompida pelo usuário." };
}

export function initAgentOrchestrator(chromeApi: typeof chrome) {
  return {
    handleMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): void {
      if (isCancelAgentMessage(message)) {
        const controller = activeRuns.get(message.requestId);
        if (!controller) { sendResponse({ ok: false, code: "SESSION_NOT_FOUND", error: "Sessão não encontrada." }); return; }
        controller.abort();
        sendResponse({ ok: true, data: { status: "cancelling" } });
        return;
      }
      if (isRunAgentMessage(message)) {
        const controller = new AbortController();
        activeRuns.set(message.requestId, controller);
        void resolveTabId(chromeApi, sender).then((tabId) => {
          if (tabId === undefined) throw new Error("No active tab is available.");
          return runAgent(chromeApi, tabId, message, controller.signal);
        }).then((data) => sendResponse({ ok: true, data }))
          .catch((error: unknown) => {
            if (controller.signal.aborted) { sendResponse({ ok: true, data: { status: "cancelled", steps: [], message: "Sessão cancelada pelo usuário." } }); return; }
            sendResponse({ ok: false, code: "AGENT_RUN_FAILED", error: error instanceof Error ? error.message : "Agent run failed." });
          })
          .finally(() => activeRuns.delete(message.requestId));
        return;
      }
      if (!isScanPageMessage(message)) {
        sendResponse({ ok: false, code: "UNSUPPORTED_MESSAGE", error: "Unsupported message." });
        return;
      }

      void resolveTabId(chromeApi, sender).then((tabId) => {
        if (tabId === undefined) {
          sendResponse({ ok: false, code: "TAB_UNAVAILABLE", error: "No active tab is available." });
          return;
        }
        return scanTab(chromeApi, tabId, message.requestId);
      })
        .then((data) => sendResponse({ ok: true, data }))
        .catch(() => sendResponse({ ok: false, code: "CONTENT_SCRIPT_UNAVAILABLE", error: "Could not inspect this page." }));
    },
  };
}

async function resolveTabId(chromeApi: typeof chrome, sender: chrome.runtime.MessageSender): Promise<number | undefined> {
  if (sender.tab?.id !== undefined) return sender.tab.id;
  const [activeTab] = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
  return activeTab?.id;
}
