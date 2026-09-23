import type { ActionResult, AgentAction, PageState } from "./types.js";
import type { JevDecision } from "./provider/jev.js";

export interface AgentLoopStep {
  step: number;
  action: AgentAction;
  optionId: string;
  confidence?: number;
  result?: ActionResult;
  verification?: ActionVerification;
}

export interface AgentLoopResult {
  status: "success" | "failed" | "cancelled" | "stalled" | "max_steps";
  steps: AgentLoopStep[];
  message: string;
}

export interface ActionVerification {
  ok: boolean;
  progressed: boolean;
  reason: string;
}

export interface AgentLoopDriver {
  observe(): Promise<PageState>;
  decide(page: PageState): Promise<JevDecision>;
  execute(action: AgentAction, actionId: string): Promise<ActionResult>;
  verify?(before: PageState, after: PageState, action: AgentAction, result: ActionResult): ActionVerification;
}

/** Runs one-action-at-a-time: observe → decide → execute → observe. */
export async function runAgentLoop(driver: AgentLoopDriver, maxSteps = 8, signal?: AbortSignal): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  let page = await driver.observe();
  let stalledSteps = 0;
  let previousOptionId: string | undefined;
  for (let step = 1; step <= maxSteps; step += 1) {
    if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
    const decision = await driver.decide(page);
    const trace: AgentLoopStep = {
      step,
      action: decision.action,
      optionId: decision.optionId,
      confidence: decision.confidence,
    };
    steps.push(trace);

    if (decision.action.type === "finish") {
      return { status: decision.action.status === "success" ? "success" : "failed", steps, message: decision.action.message };
    }

    const result = await driver.execute(decision.action, `agent_step_${step}`);
    trace.result = result;
    if (!result.ok) return { status: "failed", steps, message: result.error ?? "A ação falhou." };

    if (signal?.aborted) return { status: "cancelled", steps, message: "Sessão cancelada pelo usuário." };
    const nextPage = await driver.observe();
    const verification = driver.verify?.(page, nextPage, decision.action, result) ?? { ok: true, progressed: true, reason: "Ação executada." };
    trace.verification = verification;
    if (!verification.ok) return { status: "failed", steps, message: verification.reason };
    if (!verification.progressed && previousOptionId === decision.optionId) stalledSteps += 1;
    else stalledSteps = 0;
    if (stalledSteps >= 2) return { status: "stalled", steps, message: "O agente não detectou progresso após ações repetidas." };
    previousOptionId = decision.optionId;
    page = nextPage;
  }
  return { status: "max_steps", steps, message: `Limite de ${maxSteps} passos atingido.` };
}
