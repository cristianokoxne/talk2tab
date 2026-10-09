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
}

export interface AgentLoopBudgets { maxDurationMs?: number; maxProviderCalls?: number; }

function actionHistoryEntry(before: PageState, after: PageState, action: AgentAction, result: ActionResult, verification: ActionVerification): GoalHistoryEvent {
  const targetRef = "target" in action ? action.target?.ref : action.type === "keypress" ? before.focusedElement : undefined;
  const target = targetRef ? before.elements.find((element) => element.ref === targetRef) : undefined;
  const event: GoalHistoryEvent = {
    type: action.type,
    targetLabel: target?.sensitive ? "sensitive control" : target?.name ?? target?.text ?? target?.role,
    progressed: verification.progressed,
    beforeUrl: before.url.split(/[?#]/, 1)[0],
    afterUrl: after.url.split(/[?#]/, 1)[0],
    evidence: verification.evidence?.slice(0, 8),
  };
  if (action.type === "type") event.valueLength = action.text.length;
  if (action.type === "select") event.valueLength = action.value.length;
  if (!result.ok) event.progressed = false;
  if (!result.ok) event.errorCode = result.code ?? "ACTION_FAILED";
  return event;
}

/** Runs one-action-at-a-time: observe → decide → execute → observe. */
export async function runAgentLoop(driver: AgentLoopDriver, maxSteps = 8, signal?: AbortSignal, budgets: AgentLoopBudgets = {}): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  const history: GoalHistoryEvent[] = [];
  const startedAt = Date.now();
  const maxDurationMs = Math.max(1_000, budgets.maxDurationMs ?? 120_000);
  const maxProviderCalls = Math.max(1, budgets.maxProviderCalls ?? maxSteps + 1);
  let providerCalls = 0;
  let page = await driver.observe();
  let stalledSteps = 0;
  let previousOptionId: string | undefined;
  const visitedStates = new Set([page.fingerprint]);
  for (let step = 1; step <= maxSteps; step += 1) {
    if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
    if (Date.now() - startedAt >= maxDurationMs) return { status: "max_duration", steps, history, message: `Tempo limite de ${maxDurationMs} ms atingido após ${history.length} ações verificadas; progresso parcial preservado.` };
    if (providerCalls >= maxProviderCalls) return { status: "max_provider_calls", steps, history, message: `Limite de ${maxProviderCalls} decisões do Jev atingido; progresso parcial preservado.` };
    let decision: JevDecision;
    try {
      providerCalls += 1;
      decision = await driver.decide(page, signal, history.slice(-12));
    } catch (error) {
      if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
      throw error;
    }
    if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
    if (Date.now() - startedAt >= maxDurationMs) return { status: "max_duration", steps, history, message: `Tempo limite de ${maxDurationMs} ms atingido; decisão não executada e progresso parcial preservado.` };
    const trace: AgentLoopStep = {
      step,
      action: decision.action,
      optionId: decision.optionId,
      confidence: decision.confidence,
    };
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
      return { status: "failed", steps, history, message: result.error ?? "A ação falhou." };
    }
    if (decision.action.type === "expand_candidates") {
      previousOptionId = undefined;
      stalledSteps = 0;
      continue;
    }

    if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
    const nextPage = await driver.observe();
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
