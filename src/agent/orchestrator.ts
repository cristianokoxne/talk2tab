import type { ActionResult, AgentAction, PageState, ProviderConfig } from "./types.js";
import { buildJevCommandMap } from "./provider/commandMap.js";
import type { BrowserTabSummary } from "./provider/commandMap.js";
import { JevProvider, JevProviderError } from "./provider/jev.js";
import { runAgentLoop } from "./loop.js";
import type { AgentLoopStep } from "./loop.js";
import { verifyAction } from "./verification.js";
import { parseGoal, updateGoalProgress } from "./intent.js";
import { waitForPageEffect } from "./waitForEffect.js";
import { findSpawnedChildTab, isRestrictedDocumentUrl, makeUninspectablePage, validateNavigationUrl } from "./navigation.js";
import { aggregateFrameObservations, parseFrameScopedRef } from "./frames.js";
import { classifyActionRisk, rebindConfirmedAction } from "./actionSafety.js";
import { latestSessionForTab, makeSessionCheckpoint, reconcileSessionCheckpoint, type AgentSessionCheckpoint, type SessionPhase, type SessionStatus } from "./sessionLifecycle.js";
import { safeTraceStep } from "./trace.js";
import { TabRunRegistry } from "./tabRunRegistry.js";

const activeRuns = new Map<string, AbortController>();
const tabRuns = new TabRunRegistry();
const releasesByRequest = new Map<string, () => void>();
const pendingConfirmations = new Map<string, { requestId: string; finish: (approved: boolean) => void }>();
const SESSION_CHECKPOINT_KEY = "agentSessionCheckpoints";
let checkpointWriteQueue = Promise.resolve();

async function saveSessionCheckpoint(chromeApi: typeof chrome, checkpoint: AgentSessionCheckpoint): Promise<void> {
  checkpointWriteQueue = checkpointWriteQueue.catch(() => undefined).then(async () => {
    const stored = await chromeApi.storage.local.get(SESSION_CHECKPOINT_KEY);
    const sessions = stored[SESSION_CHECKPOINT_KEY] && typeof stored[SESSION_CHECKPOINT_KEY] === "object"
      ? stored[SESSION_CHECKPOINT_KEY] as Record<string, AgentSessionCheckpoint>
      : {};
    sessions[checkpoint.requestId] = checkpoint;
    const recent = Object.entries(sessions).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 20);
    await chromeApi.storage.local.set({ [SESSION_CHECKPOINT_KEY]: Object.fromEntries(recent) });
  });
  await checkpointWriteQueue;
  try { await chromeApi.runtime.sendMessage({ type: "AGENT_SESSION_UPDATED", data: checkpoint }); } catch { /* The panel may be closed. */ }
}

function isGetAgentSessionMessage(value: unknown): value is { type: "GET_AGENT_SESSION" } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "GET_AGENT_SESSION";
}

class TabRunBusyError extends Error {
  readonly code = "TAB_SESSION_BUSY";
}

interface ResolveActionConfirmationMessage {
  type: "RESOLVE_AGENT_ACTION_CONFIRMATION";
  confirmationId: string;
  requestId: string;
  approved: boolean;
}

function isResolveActionConfirmationMessage(value: unknown): value is ResolveActionConfirmationMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "RESOLVE_AGENT_ACTION_CONFIRMATION"
    && typeof message.confirmationId === "string"
    && typeof message.requestId === "string"
    && typeof message.approved === "boolean";
}

function describeActionForConfirmation(action: AgentAction, page: PageState): string {
  if (action.type === "click") {
    const element = page.elements.find((candidate) => candidate.ref === action.target.ref);
    const label = element?.name ?? element?.text ?? element?.role ?? "controle sem rótulo";
    return `O Jev quer clicar em “${label}”.`;
  }
  if (action.type === "select") {
    const element = page.elements.find((candidate) => candidate.ref === action.target.ref);
    const option = element?.options?.find((candidate) => candidate.value === action.value);
    return `O Jev quer selecionar “${option?.label ?? "opção desconhecida"}” em “${element?.name ?? element?.role ?? "controle sem rótulo"}”.`;
  }
  if (action.type === "keypress") return `O Jev quer pressionar ${action.key}.`;
  if (action.type === "close_tab") return "O Jev quer fechar uma aba do navegador.";
  return `O Jev quer executar a ação “${action.type}”.`;
}

function requestActionConfirmation(
  chromeApi: typeof chrome,
  requestId: string,
  action: AgentAction,
  page: PageState,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return; }
    const confirmationId = crypto.randomUUID();
    let settled = false;
    const finish = (approved: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      pendingConfirmations.delete(confirmationId);
      resolve(approved);
    };
    const onAbort = (): void => finish(false);
    const timeout = setTimeout(() => finish(false), 60_000);
    pendingConfirmations.set(confirmationId, { requestId, finish });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) { finish(false); return; }
    void chromeApi.runtime.sendMessage({
      type: "AGENT_ACTION_CONFIRMATION_REQUIRED",
      confirmationId,
      requestId,
      summary: describeActionForConfirmation(action, page),
    }).catch(() => finish(false));
  });
}

export interface ScanPageMessage {
  type: "SCAN_PAGE";
  requestId: string;
}

interface ScannerOverlayMessage { type: "SCANNER_OVERLAY"; enabled: boolean; tabId: number; }

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
    if (signal.aborted) onAbort();
  });
}

function isScanPageMessage(value: unknown): value is ScanPageMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "SCAN_PAGE" && typeof message.requestId === "string";
}

function isScannerOverlayMessage(value: unknown): value is ScannerOverlayMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "SCANNER_OVERLAY" && typeof message.enabled === "boolean" && Number.isInteger(message.tabId);
}

async function setScannerOverlay(chromeApi: typeof chrome, tabId: number, enabled: boolean): Promise<void> {
  const frames = await chromeApi.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => true });
  const results = await Promise.allSettled(frames.map((frame) => chromeApi.tabs.sendMessage(tabId, { type: "SCANNER_OVERLAY", enabled }, { frameId: frame.frameId })));
  if (!results.some((result, index) => result.status === "fulfilled" && frames[index]?.frameId === 0)) {
    throw new Error("Could not update the reference overlay in the main frame.");
  }
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
  try {
    await chromeApi.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["contentScript.js"] });
  } catch {
    // Static all-frame injection may already be active even when the document blocks reinjection.
  }
  let injections: Array<{ frameId: number; result?: { url: string; title: string } }>;
  try {
    injections = await chromeApi.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({ url: location.href, title: document.title }),
    }) as Array<{ frameId: number; result?: { url: string; title: string } }>;
  } catch {
    injections = [{ frameId: 0, result: { url: "", title: "" } }];
  }
  const frames = new Map(injections.map((entry) => [entry.frameId, {
    frameId: entry.frameId,
    url: safeFrameUrl(entry.result?.url ?? ""),
    title: entry.result?.title ?? "",
    accessible: false,
  }]));
  if (!frames.has(0)) frames.set(0, { frameId: 0, url: "", title: "", accessible: false });
  const observations = await Promise.all([...frames.values()].map(async (frame) => {
    try {
      const response = await chromeApi.tabs.sendMessage(tabId, { type: "PAGE_SCAN_REQUEST", requestId }, { frameId: frame.frameId }) as ContentScanResponse | undefined;
      return response?.ok && response.data ? { frame: { ...frame, accessible: true }, state: response.data } : undefined;
    } catch { return undefined; }
  }));
  const accessible = observations.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  if (!accessible.some(({ frame }) => frame.frameId === 0)) throw new Error("Could not inspect the main page frame.");
  const top = accessible.find(({ frame }) => frame.frameId === 0)!.state;
  const missingEmbedded = Math.max(0, (top.embeddedFrames?.length ?? 0) - (accessible.length - 1));
  return aggregateFrameObservations(accessible, missingEmbedded);
}

function safeFrameUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? `${url.origin}${url.pathname}` : `${url.protocol}//`;
  } catch { return ""; }
}

function routeFrameAction(action: import("./types.js").BrowserAction, page: PageState): { frameId: number; action: import("./types.js").BrowserAction } {
  let ref: string | undefined;
  if ("target" in action) ref = action.target?.ref;
  if (action.type === "keypress" && page.focusedElement) ref = page.focusedElement;
  const parsed = ref ? parseFrameScopedRef(ref) : undefined;
  if (!parsed) return { frameId: 0, action };
  const routed = action.type === "scroll"
    ? { ...action, target: action.target ? { ref: parsed.localRef } : undefined }
    : action.type === "click" || action.type === "type" || action.type === "select"
      ? { ...action, target: { ref: parsed.localRef } }
      : action;
  return { frameId: parsed.frameId, action: routed };
}

async function listTabs(chromeApi: typeof chrome): Promise<BrowserTabSummary[]> {
  const tabs = await chromeApi.tabs.query({});
  return tabs.flatMap((tab) => tab.id === undefined || tab.windowId === undefined ? [] : [{ id: tab.id, title: tab.title ?? "", url: tab.url ?? "", active: Boolean(tab.active), windowId: tab.windowId }]);
}

async function waitForTabLoaded(chromeApi: typeof chrome, tabId: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("Tab load wait cancelled.");
  const tab = await chromeApi.tabs.get(tabId);
  if (signal?.aborted) throw new Error("Tab load wait cancelled.");
  if (tab.status === "complete") return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      chromeApi.tabs.onUpdated.removeListener(listener);
      chromeApi.tabs.onRemoved.removeListener(removed);
      signal?.removeEventListener("abort", aborted);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const listener = (updatedTabId: number, info: { status?: string }): void => {
      if (updatedTabId !== tabId || info.status !== "complete") return;
      finish();
    };
    const removed = (removedTabId: number): void => {
      if (removedTabId === tabId) finish(new Error("The target tab was closed while loading."));
    };
    const aborted = (): void => finish(new Error("Tab load wait cancelled."));
    const timer = setTimeout(() => finish(), 10_000);
    chromeApi.tabs.onUpdated.addListener(listener);
    chromeApi.tabs.onRemoved.addListener(removed);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

async function executeBrowserAction(chromeApi: typeof chrome, action: import("./types.js").BrowserAction, currentTabId: { value: number }, signal?: AbortSignal, linkTab?: (tabId: number) => boolean): Promise<ActionResult> {
  if (action.type === "navigate") {
    await chromeApi.tabs.update(currentTabId.value, { url: validateNavigationUrl(action.url), active: true });
    await waitForTabLoaded(chromeApi, currentTabId.value, signal);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "search_web") {
    const url = `https://www.google.com/search?q=${encodeURIComponent(action.query)}`;
    await chromeApi.tabs.update(currentTabId.value, { url, active: true });
    await waitForTabLoaded(chromeApi, currentTabId.value, signal);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "open_tab") {
    const tab = await chromeApi.tabs.create({ url: validateNavigationUrl(action.url), active: true });
    if (tab.id === undefined) throw new Error("Não foi possível criar a nova aba.");
    if (linkTab && !linkTab(tab.id)) throw new TabRunBusyError("A nova aba já está sendo controlada por outra sessão.");
    currentTabId.value = tab.id;
    await waitForTabLoaded(chromeApi, tab.id, signal);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "open_window") {
    const created = await chromeApi.windows.create({ url: validateNavigationUrl(action.url), focused: true, type: "normal" });
    if (!created) throw new Error("Não foi possível criar a nova janela.");
    const tabId = created.tabs?.[0]?.id;
    if (tabId === undefined) throw new Error("Não foi possível criar a nova janela.");
    if (linkTab && !linkTab(tabId)) throw new TabRunBusyError("A nova janela já está sendo controlada por outra sessão.");
    currentTabId.value = tabId;
    await waitForTabLoaded(chromeApi, tabId, signal);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "switch_tab") {
    if (linkTab && !linkTab(action.tabId)) throw new TabRunBusyError("A aba de destino já está sendo controlada por outra sessão.");
    await chromeApi.tabs.update(action.tabId, { active: true });
    const tab = await chromeApi.tabs.get(action.tabId);
    currentTabId.value = action.tabId;
    if (tab.windowId !== undefined) await chromeApi.windows.update(tab.windowId, { focused: true });
    await waitForTabLoaded(chromeApi, action.tabId, signal);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "go_back" || action.type === "go_forward") {
    if (action.type === "go_back") await chromeApi.tabs.goBack(currentTabId.value);
    else await chromeApi.tabs.goForward(currentTabId.value);
    await waitForTabLoaded(chromeApi, currentTabId.value, signal);
    return { ok: true, actionId: "browser", changed: true, status: "success" };
  }
  if (action.type === "close_tab") {
    const closingTab = await chromeApi.tabs.get(action.tabId);
    await chromeApi.tabs.remove(action.tabId);
    const [next] = closingTab.windowId === undefined ? [] : await chromeApi.tabs.query({ active: true, windowId: closingTab.windowId });
    if (next?.id === undefined) throw new Error("Não há outra aba ativa disponível.");
    if (linkTab && !linkTab(next.id)) throw new TabRunBusyError("A aba de destino já está sendo controlada por outra sessão.");
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

function publishTraceStep(chromeApi: typeof chrome, requestId: string, step: AgentLoopStep): void {
  try { void chromeApi.runtime.sendMessage({ type: "AGENT_TRACE_UPDATE", requestId, step: safeTraceStep(step) }).catch(() => undefined); } catch { /* The panel may be closed. */ }
}

async function runAgent(chromeApi: typeof chrome, tabId: number, message: RunAgentMessage, signal: AbortSignal, linkTab: (tabId: number) => boolean): Promise<unknown> {
  const currentTabId = { value: tabId };
  let checkpoint = makeSessionCheckpoint({ requestId: message.requestId, status: "running", phase: "deciding", tabId, step: 0 });
  await saveSessionCheckpoint(chromeApi, checkpoint);
  const updateCheckpoint = async (status: SessionStatus, phase: SessionPhase, step: number, actionType?: string, page?: PageState): Promise<void> => {
    checkpoint = makeSessionCheckpoint({ requestId: message.requestId, status, phase, tabId: currentTabId.value, step, actionType, pageUrl: page?.url, pageFingerprint: page?.fingerprint });
    await saveSessionCheckpoint(chromeApi, checkpoint);
  };
  if (isContinuousScrollGoal(message.goal)) {
    const result = await runContinuousScroll(chromeApi, tabId, message, signal, updateCheckpoint) as { status: string; steps?: unknown[] };
    const status: SessionStatus = result.status === "cancelled" ? "cancelled" : result.status === "success" ? "completed" : "failed";
    await updateCheckpoint(status, checkpoint.phase, result.steps?.length ?? checkpoint.step, undefined);
    return result;
  }
  const config = await loadProviderConfig(chromeApi);
  const budgetSettings = await chromeApi.storage.local.get("agentBudgets");
  const storedBudgets = budgetSettings.agentBudgets as { maxSteps?: unknown; maxDurationMs?: unknown; maxProviderCalls?: unknown } | undefined;
  const configuredInteger = (value: unknown, fallback: number, minimum: number, maximum: number): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value))) : fallback;
  const budgets = {
    maxSteps: configuredInteger(storedBudgets?.maxSteps, 8, 1, 50),
    maxDurationMs: configuredInteger(storedBudgets?.maxDurationMs, 120_000, 1_000, 600_000),
    maxProviderCalls: configuredInteger(storedBudgets?.maxProviderCalls, 8, 1, 50),
  };
  const provider = new JevProvider(config);
  let candidateOffset = 0;
  let observationStep = 0;
  let latestPage: PageState | undefined;
  const observationDurations = new WeakMap<PageState, number>();
  const result = await runAgentLoop({
    observe: async () => {
      const observationStartedAt = performance.now();
      let page: PageState;
      try {
        page = await scanTab(chromeApi, currentTabId.value, message.requestId);
      } catch (error) {
        const tab = await chromeApi.tabs.get(currentTabId.value);
        if (!tab.url || !isRestrictedDocumentUrl(tab.url)) throw error;
        page = makeUninspectablePage(tab.url, tab.title ?? "Página não inspecionável");
      }
      observationDurations.set(page, performance.now() - observationStartedAt);
      latestPage = page;
      if (checkpoint.phase === "action_dispatched" || checkpoint.phase === "observing") {
        await updateCheckpoint("running", "deciding", checkpoint.step, undefined, page);
      }
      observationStep += 1;
      publishPageState(chromeApi, message.requestId, observationStep, currentTabId.value, page);
      return page;
    },
    decide: async (page, decisionSignal, history = []) => {
      const mapStartedAt = performance.now();
      const { map, options } = buildJevCommandMap(message.goal, page, await listTabs(chromeApi), history.map((entry) => entry.type), candidateOffset, history);
      const commandMapMs = performance.now() - mapStartedAt;
      const decision = await provider.chooseNextAction(map, options, decisionSignal);
      return { ...decision, commandMapMs };
    },
    observationTimeMs: (page) => observationDurations.get(page),
    onTrace: (step) => publishTraceStep(chromeApi, message.requestId, step),
    execute: async (action, actionId) => {
      if (action.type === "expand_candidates") {
        candidateOffset = action.nextOffset;
        return { ok: true, actionId, status: "success", changed: true };
      }
      let executableAction: AgentAction = action;
      if (latestPage) {
        const risk = classifyActionRisk(action, latestPage, message.goal);
        if (risk === "blocked") return { ok: false, actionId, code: "ACTION_NOT_AUTHORIZED", error: "Essa ação de alto impacto não corresponde ao objetivo informado pelo usuário." };
        if (risk === "confirmation") {
          const confirmedPage = latestPage;
          const confirmedTabId = currentTabId.value;
          await updateCheckpoint("awaiting_confirmation", "awaiting_confirmation", observationStep, action.type, confirmedPage);
          const approved = await requestActionConfirmation(chromeApi, message.requestId, action, confirmedPage, signal);
          if (approved) {
            const currentPage = await scanTab(chromeApi, currentTabId.value, message.requestId);
            const rebound = rebindConfirmedAction(action, confirmedPage, currentPage, confirmedTabId, currentTabId.value);
            if (!rebound) return { ok: false, actionId, code: "CONFIRMATION_CONTEXT_CHANGED", error: "A página, aba ou alvo mudou durante a confirmação; a ação foi cancelada." };
            executableAction = rebound;
            latestPage = currentPage;
          }
          if (!approved) await updateCheckpoint("running", "deciding", observationStep, undefined, confirmedPage);
          if (!approved && signal.aborted) return { ok: true, actionId, changed: false, status: "success" };
          if (!approved) return { ok: false, actionId, code: "USER_CONFIRMATION_REQUIRED", error: "A ação foi cancelada ou a confirmação expirou." };
        }
      }
      if (["navigate", "search_web", "open_tab", "open_window", "switch_tab", "close_tab", "go_back", "go_forward"].includes(executableAction.type)) {
        await updateCheckpoint("running", "dispatching", observationStep, executableAction.type, latestPage);
        const result = await executeBrowserAction(chromeApi, executableAction as import("./types.js").BrowserAction, currentTabId, signal, linkTab);
        await updateCheckpoint("running", result.ok ? "action_dispatched" : "deciding", observationStep, result.ok ? executableAction.type : undefined, latestPage);
        if (result.ok && ["open_tab", "open_window", "switch_tab", "close_tab"].includes(executableAction.type) && !linkTab(currentTabId.value)) {
          return { ok: false, actionId, code: "TAB_SESSION_BUSY", error: "A aba de destino já está sendo controlada por outra sessão." };
        }
        result.actionId = actionId;
        return result;
      }
      const knownTabIds = executableAction.type === "click"
        ? new Set((await chromeApi.tabs.query({})).flatMap((tab) => tab.id === undefined ? [] : [tab.id]))
        : undefined;
      const routed = routeFrameAction(executableAction as import("./types.js").BrowserAction, latestPage ?? await scanTab(chromeApi, currentTabId.value, message.requestId));
      await updateCheckpoint("running", "dispatching", observationStep, executableAction.type, latestPage);
      const result = await chromeApi.tabs.sendMessage(currentTabId.value, { type: "EXECUTE_ACTION", actionId, action: routed.action }, { frameId: routed.frameId }) as ActionResult;
      await updateCheckpoint("running", result.dispatched || result.ok ? "action_dispatched" : "deciding", observationStep, result.dispatched || result.ok ? executableAction.type : undefined, latestPage);
      if (knownTabIds && result.dispatched) {
        const tabs = await chromeApi.tabs.query({});
        const childTabId = findSpawnedChildTab(tabs.flatMap((tab) => tab.id === undefined ? [] : [{ id: tab.id, openerTabId: tab.openerTabId }]), knownTabIds, currentTabId.value);
        if (childTabId !== undefined) {
          if (!linkTab(childTabId)) return { ok: false, actionId, code: "TAB_SESSION_BUSY", error: "A nova aba aberta já está sendo controlada por outra sessão." };
          currentTabId.value = childTabId;
          await waitForTabLoaded(chromeApi, childTabId, signal);
        }
      }
      await waitForTabLoaded(chromeApi, currentTabId.value, signal);
      return result;
    },
    verify: verifyAction,
    waitForEffect: async (before, action, _result, observe, waitSignal) => {
      if (action.type !== "click" && action.type !== "keypress") return undefined;
      const page = await waitForPageEffect(observe, before, waitSignal, { timeoutMs: 3_000, pollIntervalMs: 50, quietWindowMs: 120 });
      latestPage = page;
      observationStep += 1;
      publishPageState(chromeApi, message.requestId, observationStep, currentTabId.value, page);
      return page;
    },
    verifyCompletion: (_page, history) => {
      const plan = parseGoal(message.goal);
      if (plan.needsClarification) return { complete: false, reason: plan.clarification ?? "Preciso de mais informações." };
      const progressed = updateGoalProgress(plan, history);
      if (progressed.stages.length && progressed.stages.some((stage) => stage.status !== "complete")) {
        const pending = progressed.stages.find((stage) => stage.status !== "complete");
        return { complete: false, reason: `Ainda falta: ${pending?.description ?? "concluir uma etapa"}. O progresso parcial foi preservado.` };
      }
      if (!history.some((entry) => entry.progressed)) return { complete: false, reason: "Nenhuma mudança que comprove a conclusão foi observada. Preciso de ajuda para continuar." };
      return { complete: true, reason: "A conclusão foi apoiada por evidência observada." };
    },
  }, budgets.maxSteps, signal, budgets);
  const effectMayBePending = ["action_dispatched", "observing", "dispatching"].includes(checkpoint.phase);
  const finalStatus: SessionStatus = effectMayBePending && (result.status === "needs_help" || result.status === "cancelled") ? "needs_reconciliation"
    : result.status === "success" ? "completed"
      : result.status === "cancelled" ? "cancelled"
        : "failed";
  await updateCheckpoint(finalStatus, checkpoint.phase, result.steps.length, finalStatus === "needs_reconciliation" ? checkpoint.actionType : undefined, latestPage);
  return result;
}

async function runContinuousScroll(chromeApi: typeof chrome, tabId: number, message: RunAgentMessage, signal: AbortSignal, checkpoint: (status: SessionStatus, phase: SessionPhase, step: number, actionType?: string, page?: PageState) => Promise<void>): Promise<unknown> {
  const currentTabId = { value: tabId };
  const direction = /\b(esquerda|left|horizontal)\b/i.test(message.goal) ? "left"
    : /\b(direita|right)\b/i.test(message.goal) ? "right"
      : /\b(cima|suba|volte)\b/i.test(message.goal) ? "up" : "down";
  const steps: Array<{ step: number; action: import("./types.js").BrowserAction; result: ActionResult }> = [];
  let step = 0;
  while (!signal.aborted) {
    const page = await scanTab(chromeApi, currentTabId.value, message.requestId);
    if (signal.aborted) return { status: "cancelled", steps, message: "Rolagem contínua interrompida pelo usuário." };
    step += 1;
    await checkpoint("running", "deciding", step, undefined, page);
    publishPageState(chromeApi, message.requestId, step, currentTabId.value, page);
    const namedContainer = page.scrollContainers?.find((container) => {
      const label = `${container.label} ${container.context ?? ""}`.toLowerCase();
      return message.goal.toLowerCase().split(/\s+/).some((word) => word.length > 3 && label.includes(word));
    });
    const action = { type: "scroll", direction, amount: "viewport", target: namedContainer ? { ref: namedContainer.ref } : undefined } as const;
    if (signal.aborted) return { status: "cancelled", steps, message: "Rolagem contínua interrompida pelo usuário." };
    const routed = routeFrameAction(action, page);
    await checkpoint("running", "dispatching", step, "scroll", page);
    const result = await chromeApi.tabs.sendMessage(currentTabId.value, { type: "EXECUTE_ACTION", actionId: `continuous_scroll_${step}`, action: routed.action }, { frameId: routed.frameId }) as ActionResult;
    await checkpoint("running", result.ok ? "action_dispatched" : "deciding", step, result.ok ? "scroll" : undefined, page);
    steps.push({ step, action, result });
    if (!result.ok) return { status: "failed", steps, message: result.error ?? "Não foi possível continuar rolando." };
    if (steps.length > 100) steps.shift();
    if (result.changed === false) return { status: "stalled", steps, message: "A rolagem chegou ao limite do conteúdo disponível." };
    await waitWithAbort(700, signal);
  }
  return { status: "cancelled", steps, message: "Rolagem contínua interrompida pelo usuário." };
}

export function initAgentOrchestrator(chromeApi: typeof chrome) {
  return {
    async recoverSession(): Promise<void> {
      const stored = await chromeApi.storage.local.get(SESSION_CHECKPOINT_KEY);
      const sessions = stored[SESSION_CHECKPOINT_KEY] && typeof stored[SESSION_CHECKPOINT_KEY] === "object"
        ? stored[SESSION_CHECKPOINT_KEY] as Record<string, AgentSessionCheckpoint>
        : {};
      await Promise.all(Object.values(sessions).map(async (checkpoint) => {
        const recovered = reconcileSessionCheckpoint(checkpoint, activeRuns.has(checkpoint.requestId));
        if (recovered !== checkpoint) await saveSessionCheckpoint(chromeApi, recovered);
      }));
    },
    handleMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): void {
      if (isScannerOverlayMessage(message)) {
        const expectedUrl = chromeApi.runtime.getURL("sidepanel.html");
        if (sender.url !== expectedUrl) {
          sendResponse({ ok: false, code: "UNTRUSTED_OVERLAY", error: "A sobreposiÃ§Ã£o deve ser controlada pelo Side Panel da extensÃ£o." });
          return;
        }
        void setScannerOverlay(chromeApi, message.tabId, message.enabled)
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false, code: "OVERLAY_UNAVAILABLE", error: "NÃ£o foi possÃ­vel atualizar as refs nesta aba." }));
        return;
      }
      if (isGetAgentSessionMessage(message)) {
        void this.recoverSession().then(async () => {
          const stored = await chromeApi.storage.local.get(SESSION_CHECKPOINT_KEY);
          const sessions = stored[SESSION_CHECKPOINT_KEY] as Record<string, AgentSessionCheckpoint> | undefined;
          const tabId = await resolveTabId(chromeApi, sender);
          const checkpoint = latestSessionForTab(Object.values(sessions ?? {}), tabId);
          sendResponse({ ok: true, data: checkpoint?.tabId === tabId ? checkpoint : null });
        }).catch(() => sendResponse({ ok: false, code: "SESSION_STATUS_UNAVAILABLE", error: "Não foi possível recuperar o estado da sessão." }));
        return;
      }
      if (isResolveActionConfirmationMessage(message)) {
        const expectedUrl = chromeApi.runtime.getURL("sidepanel.html");
        if (sender.url !== expectedUrl) {
          sendResponse({ ok: false, code: "UNTRUSTED_CONFIRMATION", error: "A confirmação deve vir do Side Panel da extensão." });
          return;
        }
        const pending = pendingConfirmations.get(message.confirmationId);
        if (!pending || pending.requestId !== message.requestId) {
          sendResponse({ ok: false, code: "CONFIRMATION_EXPIRED", error: "Esta confirmação não está mais ativa." });
          return;
        }
        pending.finish(message.approved);
        sendResponse({ ok: true });
        return;
      }
      if (isCancelAgentMessage(message)) {
        const controller = activeRuns.get(message.requestId);
        if (!controller) { sendResponse({ ok: false, code: "SESSION_NOT_FOUND", error: "Sessão não encontrada." }); return; }
        controller.abort();
        sendResponse({ ok: true, data: { status: "cancelling" } });
        return;
      }
      if (isRunAgentMessage(message)) {
        if (activeRuns.has(message.requestId)) {
          sendResponse({ ok: false, code: "DUPLICATE_SESSION", error: "Uma sessão com este identificador já está ativa." });
          return;
        }
        const controller = new AbortController();
        activeRuns.set(message.requestId, controller);
        const linkedTabReleases: Array<() => void> = [];
        const linkedTabIds = new Set<number>();
        void resolveTabId(chromeApi, sender).then((tabId) => {
          if (tabId === undefined) throw new Error("No active tab is available.");
          if (controller.signal.aborted) throw new Error("Sessão cancelada pelo usuário.");
          const releaseTab = tabRuns.acquire(tabId, message.requestId);
          if (!releaseTab) {
            const owner = tabRuns.ownerOf(tabId);
            throw new TabRunBusyError(`Aba já está sendo controlada pela sessão ${owner ?? "desconhecida"}.`);
          }
          releasesByRequest.set(message.requestId, releaseTab);
          linkedTabIds.add(tabId);
          const linkTab = (linkedTabId: number): boolean => {
            if (linkedTabIds.has(linkedTabId)) return true;
            const releaseLinked = tabRuns.acquire(linkedTabId, message.requestId);
            if (!releaseLinked) return false;
            linkedTabReleases.push(releaseLinked);
            linkedTabIds.add(linkedTabId);
            return true;
          };
          return runAgent(chromeApi, tabId, message, controller.signal, linkTab);
        }).then(async (data) => {
          const stored = await chromeApi.storage.local.get(SESSION_CHECKPOINT_KEY);
          const sessions = stored[SESSION_CHECKPOINT_KEY] as Record<string, AgentSessionCheckpoint> | undefined;
          const checkpoint = sessions?.[message.requestId];
          if (checkpoint?.requestId === message.requestId && checkpoint.status === "running") {
            const status: SessionStatus = checkpoint.phase === "dispatching" || checkpoint.phase === "action_dispatched" || checkpoint.phase === "observing" ? "needs_reconciliation" : "failed";
            await saveSessionCheckpoint(chromeApi, { ...checkpoint, status, updatedAt: Date.now() });
          }
          sendResponse({ ok: true, data });
        })
          .catch(async (error: unknown) => {
            if (controller.signal.aborted) { sendResponse({ ok: true, data: { status: "cancelled", steps: [], message: "Sessão cancelada pelo usuário." } }); return; }
            const stored = await chromeApi.storage.local.get(SESSION_CHECKPOINT_KEY);
            const sessions = stored[SESSION_CHECKPOINT_KEY] as Record<string, AgentSessionCheckpoint> | undefined;
            const checkpoint = sessions?.[message.requestId];
            if (checkpoint?.requestId === message.requestId && ["running", "awaiting_confirmation"].includes(checkpoint.status)) {
              const status: SessionStatus = checkpoint.phase === "dispatching" || checkpoint.phase === "action_dispatched" || checkpoint.phase === "observing" ? "needs_reconciliation" : "failed";
              await saveSessionCheckpoint(chromeApi, { ...checkpoint, status, updatedAt: Date.now() });
            }
            const code = error instanceof JevProviderError ? error.code
              : error instanceof TabRunBusyError ? error.code
              : error instanceof Error && error.message.includes("target tab was closed") ? "TAB_UNAVAILABLE"
                : "AGENT_RUN_FAILED";
            sendResponse({ ok: false, code, error: error instanceof Error ? error.message : "Agent run failed." });
          })
          .finally(() => {
            for (const releaseLinked of linkedTabReleases) releaseLinked();
            releasesByRequest.get(message.requestId)?.();
            releasesByRequest.delete(message.requestId);
            activeRuns.delete(message.requestId);
          });
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
        return scanTab(chromeApi, tabId, message.requestId).then((data) => ({ tabId, data }));
      })
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch(() => sendResponse({ ok: false, code: "CONTENT_SCRIPT_UNAVAILABLE", error: "Could not inspect this page." }));
    },
  };
}

async function resolveTabId(chromeApi: typeof chrome, sender: chrome.runtime.MessageSender): Promise<number | undefined> {
  if (sender.tab?.id !== undefined) return sender.tab.id;
  const [activeTab] = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
  return activeTab?.id;
}
