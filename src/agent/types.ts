export type RiskLevel = "read" | "edit" | "critical";

export interface ClickAction { type: "click"; target: { ref: string }; }
export interface TypeAction { type: "type"; target: { ref: string }; text: string; replace?: boolean; }
export interface ScrollAction { type: "scroll"; direction: "up" | "down"; amount: "viewport" | number; }
export interface KeyPressAction { type: "keypress"; key: string; }
export type BrowserAction = ClickAction | TypeAction | ScrollAction | KeyPressAction;

export interface ActionRequest { id: string; action: BrowserAction; }

export interface ActionResult {
  ok: boolean;
  actionId: string;
  error?: string;
  code?: string;
  changed?: boolean;
  snapshot?: string;
  status?: "success" | "failed";
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

export interface ViewportState {
  width: number;
  height: number;
  scrollY: number;
}

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageState {
  url: string;
  title: string;
  viewport: ViewportState;
  pageTextSummary: string;
  fingerprint: string;
  elements: ElementRef[];
  limitations: string[];
}

export interface ElementRef {
  ref: string;
  frameId: number;
  tag: string;
  role?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  text?: string;
  href?: string;
  visible: boolean;
  enabled: boolean;
  checked?: boolean;
  selected?: boolean;
  sensitive?: boolean;
  bounds: ElementBounds;
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

