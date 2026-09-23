export type RiskLevel = "read" | "edit" | "critical";

export interface ClickAction { type: "click"; target: { ref: string }; }
export interface TypeAction { type: "type"; target: { ref: string }; text: string; replace?: boolean; }
export interface SelectAction { type: "select"; target: { ref: string }; value: string; }
export interface ScrollAction { type: "scroll"; direction: "up" | "down"; amount: "viewport" | number; target?: { ref: string }; }
export interface KeyPressAction { type: "keypress"; key: string; }
export interface NavigateAction { type: "navigate"; url: string; }
export interface SearchWebAction { type: "search_web"; query: string; }
export interface OpenTabAction { type: "open_tab"; url: string; }
export interface OpenWindowAction { type: "open_window"; url: string; }
export interface SwitchTabAction { type: "switch_tab"; tabId: number; }
export interface CloseTabAction { type: "close_tab"; tabId: number; }
export type BrowserAction = ClickAction | TypeAction | SelectAction | ScrollAction | KeyPressAction | NavigateAction | SearchWebAction | OpenTabAction | OpenWindowAction | SwitchTabAction | CloseTabAction;
export interface FinishAction { type: "finish"; status: "success" | "failed"; message: string; }
export type AgentAction = BrowserAction | FinishAction;

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
  endpoint?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
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
  scrollContainers?: ScrollContainerRef[];
  limitations: string[];
}

export interface ScrollContainerRef {
  ref: string;
  label: string;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  bounds: ElementBounds;
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
  options?: Array<{ value: string; label: string }>;
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

