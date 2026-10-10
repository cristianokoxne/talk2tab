import type { ActionResult, AgentAction, PageState } from "./types.js";
import type { JevDecision } from "./provider/jev.js";
import type { GoalHistoryEvent } from "./intent.js";

export interface AgentLoopStep {
  step: number;
  action: AgentAction;
  optionId: string;
  confidence?: number;
  result?: ActionResult;
  verification?: ActionVerification;
}

export interface AgentLoopResult {
  status: "success" | "failed" | "needs_help" | "cancelled" | "stalled" | "max_steps" | "max_duration" | "max_provider_calls";
  steps: AgentLoopStep[];
  message: string;
  history?: GoalHistoryEvent[];
}

export interface ActionVerification {
  ok: boolean;
  progressed: boolean;
  effectObserved?: boolean;
  evidence?: string[];
  reason: string;
}

export interface AgentLoopDriver {
  observe(): Promise<PageState>;
  decide(page: PageState, signal?: AbortSignal, history?: GoalHistoryEvent[]): Promise<JevDecision>;
  execute(action: AgentAction, actionId: string): Promise<ActionResult>;
  verify?(before: PageState, after: PageState, action: AgentAction, result: ActionResult): ActionVerification;
  verifyCompletion?(page: PageState, history: GoalHistoryEvent[]): { complete: boolean; reason: string };
  waitForEffect?(before: PageState, action: AgentAction, result: ActionResult, observe: () => Promise<PageState>, signal?: AbortSignal): Promise<PageState | undefined>;
}

export interface AgentLoopBudgets { maxDurationMs?: number; maxProviderCalls?: number; }

function actionHistoryEntry(before: PageState, after: PageState, action: AgentAction, result: ActionResult, verification: ActionVerification): GoalHistoryEvent {
  const targetRef = "target" in action ? action.target?.ref : action.type === "keypress" ? before.focusedElement : undefined;
  const target = targetRef ? before.elements.find((element) => element.ref === targetRef) : undefined;
  const targetLabel = target?.sensitive ? "sensitive control" : [target?.name, target?.context].filter(Boolean).join(" ") || target?.role;
  const actionKey = action.type === "keypress" ? `${action.type}:${action.key.toLowerCase()}`
    : targetLabel ? `${action.type}:${targetLabel.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}`
      : action.type === "navigate" || action.type === "open_tab" || action.type === "open_window" ? `${action.type}:${action.url.split(/[?#]/, 1)[0]}`
        : action.type;
  const event: GoalHistoryEvent = {
    type: action.type,
    actionKey,
    targetLabel,
    targetRole: target?.role,
    dispatched: result.dispatched === true,
    progressed: verification.progressed,
    beforeUrl: before.url.split(/[?#]/, 1)[0],
    afterUrl: after.url.split(/[?#]/, 1)[0],
    evidence: verification.evidence?.slice(0, 8),
  };
  if (action.type === "type") event.valueLength = action.text.length;
  if (action.type === "select") event.valueLength = action.value.length;
  if (action.type === "select") event.selectionLabel = result.selectionLabel;
  if (!result.ok) event.progressed = false;
  if (!result.ok) event.errorCode = result.code ?? "ACTION_FAILED";
  return event;
}

function backoff(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function observeWithRetry(driver: AgentLoopDriver, signal?: AbortSignal): Promise<PageState> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await driver.observe(); }
    catch (error) {
      if (signal?.aborted || attempt >= 2) throw error;
      await backoff([100, 250][attempt], signal);
    }
  }
}

function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown };
  return value.code === "PROVIDER_NETWORK_ERROR" || (value.code === "PROVIDER_HTTP_ERROR" && [429, 502, 503, 504].includes(Number(value.status)));
}

const recoverablePreDispatchCodes = new Set(["STALE_ELEMENT", "STALE_SCROLL_CONTAINER"]);

/** Runs one-action-at-a-time: observe → decide → execute → observe. */
export async function runAgentLoop(driver: AgentLoopDriver, maxSteps = 8, signal?: AbortSignal, budgets: AgentLoopBudgets = {}): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  const history: GoalHistoryEvent[] = [];
  if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
  const startedAt = Date.now();
  const maxDurationMs = Math.max(1_000, budgets.maxDurationMs ?? 120_000);
  const maxProviderCalls = Math.max(1, budgets.maxProviderCalls ?? maxSteps + 1);
  let providerCalls = 0;
  let page = await observeWithRetry(driver, signal);
  let stalledSteps = 0;
  let previousOptionId: string | undefined;
  const visitedStates = new Set([page.fingerprint]);
  const staleRetries = new Map<string, number>();
  for (let step = 1; step <= maxSteps; step += 1) {
    if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
    if (Date.now() - startedAt >= maxDurationMs) return { status: "max_duration", steps, history, message: `Tempo limite de ${maxDurationMs} ms atingido após ${history.length} ações verificadas; progresso parcial preservado.` };
    if (providerCalls >= maxProviderCalls) return { status: "max_provider_calls", steps, history, message: `Limite de ${maxProviderCalls} decisões do Jev atingido; progresso parcial preservado.` };
    let decision: JevDecision | undefined;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        providerCalls += 1;
        decision = await driver.decide(page, signal, history.slice(-12));
        break;
      } catch (error) {
        if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
        if (isRetryableProviderError(error) && providerCalls >= maxProviderCalls) return { status: "max_provider_calls", steps, history, message: `Limite de ${maxProviderCalls} chamadas do Jev atingido após erro transitório; progresso parcial preservado.` };
        if (!isRetryableProviderError(error) || attempt >= 2 || providerCalls >= maxProviderCalls) throw error;
        await backoff([100, 300][attempt], signal);
      }
    }
    if (!decision) return { status: "failed", steps, history, message: "O provider não retornou uma decisão válida." };
    if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
    if (Date.now() - startedAt >= maxDurationMs) return { status: "max_duration", steps, history, message: `Tempo limite de ${maxDurationMs} ms atingido; decisão não executada e progresso parcial preservado.` };
    const trace: AgentLoopStep = {
      step,
      action: decision.action,
      optionId: decision.optionId,
      confidence: decision.confidence,
    };
    const repeatedUnknownEffect = history.at(-1);
    const actionTargetRef = "target" in decision.action ? decision.action.target?.ref : undefined;
    const targetForAction = actionTargetRef ? page.elements.find((element) => element.ref === actionTargetRef) : undefined;
    const stableTargetLabel = targetForAction?.sensitive ? "sensitive control" : [targetForAction?.name, targetForAction?.context].filter(Boolean).join(" ") || targetForAction?.role;
    const retryKey = decision.action.type === "keypress" ? `${decision.action.type}:${decision.action.key.toLowerCase()}`
      : stableTargetLabel ? `${decision.action.type}:${stableTargetLabel.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}`
        : decision.action.type === "navigate" || decision.action.type === "open_tab" || decision.action.type === "open_window" ? `${decision.action.type}:${decision.action.url.split(/[?#]/, 1)[0]}`
          : decision.action.type;
    if (repeatedUnknownEffect?.dispatched && !repeatedUnknownEffect.progressed && repeatedUnknownEffect.actionKey === retryKey) {
      return { status: "needs_help", steps, history, message: "A última ação foi enviada, mas seu efeito continua desconhecido. Não vou repeti-la sem reconciliação." };
    }
    steps.push(trace);

    if (decision.action.type === "finish") {
      if (decision.action.status === "success" && driver.verifyCompletion) {
        const completion = driver.verifyCompletion(page, history);
        if (!completion.complete) return { status: "needs_help", steps, history, message: completion.reason };
      }
      return { status: decision.action.status === "success" ? "success" : "failed", steps, history, message: decision.action.message };
    }

    const result = await driver.execute(decision.action, `agent_step_${step}`);
    trace.result = result;
    if (!result.ok) {
      history.push(actionHistoryEntry(page, page, decision.action, result, { ok: false, progressed: false, reason: result.error ?? "A ação falhou." }));
      const retries = result.code ? staleRetries.get(result.code) ?? 0 : 0;
      if (result.code && recoverablePreDispatchCodes.has(result.code) && result.dispatched !== true && retries < 2) {
        staleRetries.set(result.code, retries + 1);
        page = await observeWithRetry(driver, signal);
        visitedStates.add(page.fingerprint);
        previousOptionId = undefined;
        stalledSteps = 0;
        continue;
      }
      return { status: "failed", steps, history, message: result.error ?? "A ação falhou." };
    }
    if (decision.action.type === "expand_candidates") {
      previousOptionId = undefined;
      stalledSteps = 0;
      continue;
    }

    if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
    const observe = (): Promise<PageState> => observeWithRetry(driver, signal);
    let nextPage: PageState;
    try {
      nextPage = await driver.waitForEffect?.(page, decision.action, result, observe, signal) ?? await observe();
    } catch (error) {
      if (signal?.aborted) return { status: "cancelled", steps, history, message: "Sessão cancelada depois da ação; o efeito pode ser desconhecido e ela não foi repetida." };
      const uncertain = actionHistoryEntry(page, page, decision.action, result, { ok: false, progressed: false, reason: "A ação foi enviada, mas a página não pôde ser observada depois." });
      uncertain.errorCode = "OBSERVATION_FAILED_AFTER_ACTION";
      history.push(uncertain);
      return { status: "needs_help", steps, history, message: "A ação pode ter sido executada, mas não consegui observar o resultado. Não vou repeti-la automaticamente." };
    }
    const verification = driver.verify?.(page, nextPage, decision.action, result) ?? { ok: true, progressed: true, reason: "Ação executada." };
    trace.verification = verification;
    history.push(actionHistoryEntry(page, nextPage, decision.action, result, verification));
    if (history.length > 50) history.splice(0, history.length - 50);
    if (!verification.ok) return { status: "failed", steps, message: verification.reason };
    if (verification.progressed && visitedStates.has(nextPage.fingerprint) && nextPage.fingerprint !== page.fingerprint) {
      return { status: "stalled", steps, message: "A navegação retornou a um estado já observado e entrou em ciclo." };
    }
    visitedStates.add(nextPage.fingerprint);
    if (!verification.progressed && previousOptionId === decision.optionId) stalledSteps += 1;
    else stalledSteps = 0;
    if (stalledSteps >= 2) return { status: "stalled", steps, message: "O agente não detectou progresso após ações repetidas." };
    previousOptionId = decision.optionId;
    page = nextPage;
  }
  if (providerCalls >= maxProviderCalls) return { status: "max_provider_calls", steps, history, message: `Limite de ${maxProviderCalls} decisões do Jev atingido após ${history.length} ações verificadas; progresso parcial preservado.` };
  return { status: "max_steps", steps, history, message: `Limite de ${maxSteps} passos atingido após ${history.length} ações verificadas; progresso parcial preservado.` };
}
