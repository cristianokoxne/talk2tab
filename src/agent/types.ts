export type RiskLevel = "read" | "edit" | "critical";

export interface ActionRequest {
  id: string;
  type: string;
  target?: { ref?: string; selector?: string; text?: string; url?: string; value?: string; key?: string };
  params?: Record<string, unknown>;
  riskLevel?: RiskLevel;
  confirm?: boolean;
}

export interface ActionResult {
  ok: boolean;
  actionId: string;
  error?: string;
  code?: string;
  changed?: boolean;
  snapshot?: string;
}

export interface ProviderConfig {
  id: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentSession {
  id: string;
  tabId: number;
  url: string;
  title: string;
  steps: number;
  maxSteps: number;
  createdAt: number;
  lastActivity: number;
  cancelled: boolean;
}

export interface PageState {
  url: string;
  title: string;
  elements: ElementRef[];
  text: string;
}

export interface ElementRef {
  ref: string;
  tag: string;
  text: string;
  selector: string;
  visible: boolean;
  enabled: boolean;
  role?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
}

export interface AgentMessage {
  type: string;
  payload?: unknown;
  tabId?: number;
  sessionId?: string;
  requestId?: string;
}

export interface AgentResponse {
  ok: boolean;
  error?: string;
  code?: string;
  data?: unknown;
  sessionId?: string;
}

export type MessageHandler = (message: AgentMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: AgentResponse) => void) => void;

