import { opaquePageFingerprint } from "./actionSafety.js";

export type SessionPhase = "deciding" | "awaiting_confirmation" | "dispatching" | "action_dispatched" | "observing";
export type SessionStatus = "running" | "awaiting_confirmation" | "interrupted" | "needs_reconciliation" | "completed" | "cancelled" | "failed";

export interface AgentSessionCheckpoint {
  requestId: string;
  status: SessionStatus;
  phase: SessionPhase;
  tabId: number;
  step: number;
  actionType?: string;
  pageOrigin?: string;
  pageFingerprint?: string;
  updatedAt: number;
}

export function makeSessionCheckpoint(input: Omit<AgentSessionCheckpoint, "updatedAt" | "pageOrigin" | "pageFingerprint"> & { pageUrl?: string; pageFingerprint?: string }, now = Date.now()): AgentSessionCheckpoint {
  let pageOrigin: string | undefined;
  try { pageOrigin = new URL(input.pageUrl ?? "").origin; } catch { /* Keep restricted page URLs private. */ }
  return {
    requestId: input.requestId,
    status: input.status,
    phase: input.phase,
    tabId: input.tabId,
    step: input.step,
    actionType: input.actionType,
    pageOrigin,
    pageFingerprint: input.pageFingerprint ? opaquePageFingerprint(input.pageFingerprint) : undefined,
    updatedAt: now,
  };
}

export function reconcileSessionCheckpoint(checkpoint: AgentSessionCheckpoint, isLive: boolean): AgentSessionCheckpoint {
  if (isLive || !["running", "awaiting_confirmation"].includes(checkpoint.status)) return checkpoint;
  return {
    ...checkpoint,
    status: checkpoint.phase === "dispatching" || checkpoint.phase === "action_dispatched" || checkpoint.phase === "observing"
      ? "needs_reconciliation"
      : "interrupted",
    phase: checkpoint.phase,
    updatedAt: Date.now(),
  };
}

export function latestSessionForTab(checkpoints: AgentSessionCheckpoint[], tabId: number | undefined): AgentSessionCheckpoint | undefined {
  if (tabId === undefined) return undefined;
  return checkpoints.filter((checkpoint) => checkpoint.tabId === tabId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export type VoiceCommandKind = "cancel" | "new" | "continuation";

export function classifyVoiceCommand(value: string): VoiceCommandKind {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (/^(pare|parar|cancele|cancelar|interrompa|interromper|stop|cancel)(?:\s+(?:agora|tudo|isso|a sessao|o agente|a tarefa))?[.!?]*$/.test(normalized)) return "cancel";
  if (/^(e\s+)?(depois|tambem|continue|continuar|em seguida)\b/.test(normalized)) return "continuation";
  return "new";
}

export function isDuplicateVoiceSegment(segments: string[], value: string): boolean {
  const key = (text: string): string => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const candidate = key(value);
  return Boolean(candidate) && segments.some((segment) => key(segment) === candidate);
}

export class VoiceGoalQueue {
  private readonly queue: string[] = [];
  private readonly recent = new Map<string, number>();

  enqueue(value: string, now = Date.now()): { kind: VoiceCommandKind; queued: boolean } {
    const normalized = value.trim().replace(/\s+/g, " ");
    const kind = classifyVoiceCommand(normalized);
    if (!normalized || kind === "cancel") return { kind, queued: false };
    let goal = kind === "continuation"
      ? normalized.replace(/^(?:(?:e\s+)?depois|tambem|continue|continuar|em seguida)\s*/i, "").trim()
      : normalized;
    if (!goal) return { kind, queued: false };
    const key = goal.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    for (const [previous, timestamp] of this.recent) if (now - timestamp > 8_000) this.recent.delete(previous);
    if (this.recent.has(key)) return { kind, queued: false };
    this.recent.set(key, now);
    if (kind === "continuation" && this.queue.length) goal = `${this.queue.pop()} e depois ${goal}`;
    this.queue.push(goal);
    return { kind, queued: true };
  }

  shift(): string | undefined { return this.queue.shift(); }
  clear(): void { this.queue.length = 0; }
  get size(): number { return this.queue.length; }
}
