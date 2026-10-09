import type { AgentAction, ProviderConfig } from "../types.js";
import type { JevCommandMap, CommandOption } from "./commandMap.js";

export interface JevChoiceAnswer {
  type?: string;
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface JevDecision {
  optionId: string;
  action: AgentAction;
  confidence?: number;
  probabilities: Record<string, number>;
  model?: string;
}

interface JevResponse {
  model?: unknown;
  answers?: { next_action?: JevChoiceAnswer };
}

export const JEV_ADAPTER_VERSION = "2";

export class JevProviderError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JevProviderError";
  }
}

export class JevProvider {
  private readonly config: Required<Pick<ProviderConfig, "endpoint" | "model">> & ProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ProviderConfig, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.config = {
      ...config,
      endpoint: config.endpoint || "https://system-one.dev/v1/systemone",
      model: config.model || "jev-latest",
    };
    this.fetchImpl = fetchImpl;
  }

  async chooseNextAction(commandMap: JevCommandMap, options: CommandOption[], signal?: AbortSignal): Promise<JevDecision> {
    if (!this.config.apiKey) throw new JevProviderError("JEV_API_KEY não configurada.", "PROVIDER_NOT_CONFIGURED");
    if (signal?.aborted) throw new JevProviderError("Jev request was cancelled before it started.", "PROVIDER_CANCELLED");
    const timeoutMs = typeof this.config.timeoutMs === "number" && Number.isFinite(this.config.timeoutMs)
      ? Math.min(120_000, Math.max(1_000, this.config.timeoutMs))
      : 30_000;
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, ...commandMap }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let details = "";
        try {
          details = (await response.text()).slice(0, 800);
        } catch {
          details = "sem detalhes adicionais";
        }
        throw new JevProviderError(`Jev retornou HTTP ${response.status}: ${details}`, "PROVIDER_HTTP_ERROR");
      }
      let payload: JevResponse;
      try {
        payload = await response.json() as JevResponse;
      } catch (error) {
        throw new JevProviderError("Resposta do Jev não contém JSON válido.", "PROVIDER_INVALID_RESPONSE", { cause: error });
      }
      const answer = payload.answers?.next_action;
      if (!answer?.choice) throw new JevProviderError("Resposta do Jev sem escolha next_action.", "PROVIDER_INVALID_RESPONSE");
      if (answer.type !== undefined && answer.type !== "choice") throw new JevProviderError("Resposta do Jev não corresponde ao tipo choice.", "PROVIDER_INVALID_RESPONSE");
      const selected = options.find((option) => option.id === answer.choice);
      if (!selected) throw new JevProviderError(`Jev escolheu uma opção desconhecida: ${answer.choice}.`, "PROVIDER_UNKNOWN_CHOICE");
      const knownIds = new Set(options.map((option) => option.id));
      if (answer.probabilities !== undefined && (!answer.probabilities || typeof answer.probabilities !== "object" || Object.entries(answer.probabilities).some(([id, probability]) => !knownIds.has(id) || !Number.isFinite(probability) || probability < 0 || probability > 1))) {
        throw new JevProviderError("Resposta do Jev contém probabilidades inválidas ou opções desconhecidas.", "PROVIDER_INVALID_RESPONSE");
      }
      if (answer.confidence !== undefined && (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)) {
        throw new JevProviderError("Resposta do Jev contém confidence fora do intervalo de 0 a 1.", "PROVIDER_INVALID_RESPONSE");
      }
      return {
        optionId: selected.id,
        action: selected.action,
        confidence: answer.confidence,
        probabilities: answer.probabilities ?? {},
        model: typeof payload.model === "string" ? payload.model : undefined,
      };
    } catch (error) {
      if (timedOut) throw new JevProviderError(`Jev request timed out after ${timeoutMs}ms.`, "PROVIDER_TIMEOUT", { cause: error });
      if (error instanceof JevProviderError) throw error;
      if (signal?.aborted) throw new JevProviderError("Jev request was cancelled.", "PROVIDER_CANCELLED", { cause: error });
      throw new JevProviderError(error instanceof Error ? error.message : "Jev network request failed.", "PROVIDER_NETWORK_ERROR", { cause: error });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
