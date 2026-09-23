import type { AgentAction, ProviderConfig } from "../types.js";
import type { JevCommandMap, CommandOption } from "./commandMap.js";

export interface JevChoiceAnswer {
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface JevDecision {
  optionId: string;
  action: AgentAction;
  confidence?: number;
  probabilities: Record<string, number>;
}

interface JevResponse {
  answers?: { next_action?: JevChoiceAnswer };
}

export class JevProvider {
  private readonly config: Required<Pick<ProviderConfig, "endpoint" | "model">> & ProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ProviderConfig, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.config = {
      ...config,
      endpoint: config.endpoint || "https://api.typesafe.ai/v1/systemone",
      model: config.model || "jev-latest",
    };
    this.fetchImpl = fetchImpl;
  }

  async chooseNextAction(commandMap: JevCommandMap, options: CommandOption[], signal?: AbortSignal): Promise<JevDecision> {
    if (!this.config.apiKey) throw new Error("JEV_API_KEY não configurada.");
    const response = await this.fetchImpl(this.config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model: this.config.model, ...commandMap }),
      signal,
    });
    if (!response.ok) {
      let details = "";
      try {
        details = (await response.text()).slice(0, 800);
      } catch {
        details = "sem detalhes adicionais";
      }
      throw new Error(`Jev retornou HTTP ${response.status}: ${details}`);
    }
    const payload = await response.json() as JevResponse;
    const answer = payload.answers?.next_action;
    if (!answer?.choice) throw new Error("Resposta do Jev sem escolha next_action.");
    const selected = options.find((option) => option.id === answer.choice);
    if (!selected) throw new Error(`Jev escolheu uma opção desconhecida: ${answer.choice}.`);
    return {
      optionId: selected.id,
      action: selected.action,
      confidence: answer.confidence,
      probabilities: answer.probabilities ?? {},
    };
  }
}
