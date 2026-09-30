import type { PageState } from "./types.js";
import { startChromeSpeechRecognition, type SpeechRecognitionRecorder } from "./voice/chromeSpeechRecognition.js";
import { createIcons, icons } from "lucide";

interface ScanResponse {
  ok: boolean;
  data?: PageState;
  error?: string;
}

interface AgentPageStateMessage {
  type: "AGENT_PAGE_STATE";
  requestId: string;
  step: number;
  tabId: number;
  data: PageState;
}

interface QueuedAgentGoal { goal: string; source: "manual" | "voice"; }
interface PendingConfirmation { confirmationId: string; requestId: string; }

function requestId(): string {
  return crypto.randomUUID();
}

export function initSidePanel(chromeApi: typeof chrome): void {
  const status = document.querySelector<HTMLElement>("#status");
  const pageState = document.querySelector<HTMLElement>("#page-state");
  const elements = document.querySelector<HTMLUListElement>("#elements");
  const debugOverlay = document.querySelector<HTMLInputElement>("#debug-overlay");
  const actionRef = document.querySelector<HTMLInputElement>("#action-ref");
  const actionText = document.querySelector<HTMLInputElement>("#action-text");
  const actionResult = document.querySelector<HTMLOutputElement>("#action-result");
  const actionDebug = document.querySelector<HTMLElement>("#action-debug");
  const clickButton = document.querySelector<HTMLButtonElement>("#action-click");
  const typeButton = document.querySelector<HTMLButtonElement>("#action-type");
  const agentGoal = document.querySelector<HTMLInputElement>("#agent-goal");
  const agentControls = document.querySelector<HTMLElement>("#agent-controls");
  const agentRun = document.querySelector<HTMLButtonElement>("#agent-run");
  const agentCancel = document.querySelector<HTMLButtonElement>("#agent-cancel");
  const voiceStart = document.querySelector<HTMLButtonElement>("#voice-start");
  const voiceStatus = document.querySelector<HTMLOutputElement>("#voice-status");
  const agentResult = document.querySelector<HTMLOutputElement>("#agent-result");
  const confirmationModal = document.querySelector<HTMLElement>("#agent-confirmation");
  const confirmationSummary = document.querySelector<HTMLElement>("#agent-confirmation-summary");
  const confirmationApprove = document.querySelector<HTMLButtonElement>("#agent-confirmation-approve");
  const confirmationReject = document.querySelector<HTMLButtonElement>("#agent-confirmation-reject");
  let pendingConfirmation: PendingConfirmation | undefined;
  let confirmationTimeout: number | undefined;
  const onboarding = document.querySelector<HTMLElement>("#jev-onboarding");
  const apiKeyInput = document.querySelector<HTMLInputElement>("#jev-api-key");
  const saveKeyButton = document.querySelector<HTMLButtonElement>("#jev-save-key");
  const onboardingStatus = document.querySelector<HTMLOutputElement>("#jev-onboarding-status");
  const editKeyButton = document.querySelector<HTMLButtonElement>("#jev-edit-key");
  if (!status || !pageState || !elements || !debugOverlay || !actionRef || !actionText || !actionResult || !actionDebug || !clickButton || !typeButton || !agentGoal || !agentControls || !agentRun || !agentCancel || !voiceStart || !voiceStatus || !agentResult || !confirmationModal || !confirmationSummary || !confirmationApprove || !confirmationReject || !onboarding || !apiKeyInput || !saveKeyButton || !onboardingStatus || !editKeyButton) return;
  createIcons({ icons });

  const renderPageMap = (data: PageState, label: string): void => {
    status.textContent = label;
    pageState.textContent = `${data.title || "Sem título"} — ${data.url}`;
    elements.replaceChildren(...data.elements.map((element) => {
      const item = document.createElement("li");
      const ref = document.createElement("code");
      ref.textContent = element.ref;
      item.dataset.ref = element.ref;
      item.title = "Clique para usar este ref no teste manual";
      item.addEventListener("click", () => { actionRef.value = element.ref; });
      item.append(ref, document.createTextNode(` ${element.role ?? element.tag}: ${element.name ?? element.text ?? "sem nome"}`));
      return item;
    }), ...(data.scrollContainers ?? []).map((container) => {
      const item = document.createElement("li");
      const ref = document.createElement("code");
      ref.textContent = container.ref;
      item.dataset.ref = container.ref;
      item.title = "Contêiner interno rolável; clique para usar o ref no teste manual";
      item.addEventListener("click", () => { actionRef.value = container.ref; });
      item.append(ref, document.createTextNode(` scroll: ${container.label} (${container.scrollTop}/${container.scrollHeight})`));
      return item;
    }));
  };

  chromeApi.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const messageType = (message as { type?: unknown }).type;
    if (messageType === "AGENT_PAGE_STATE") {
      const update = message as AgentPageStateMessage;
      renderPageMap(update.data, `Pagemap atualizado · passo ${update.step} · ${update.data.elements.length} refs`);
      return;
    }
    if (messageType === "AGENT_ACTION_CONFIRMATION_REQUIRED") {
      const confirmation = message as { confirmationId?: string; requestId?: string; summary?: string };
      if (typeof confirmation.confirmationId !== "string" || typeof confirmation.requestId !== "string") return;
      pendingConfirmation = { confirmationId: confirmation.confirmationId, requestId: confirmation.requestId };
      confirmationSummary.textContent = confirmation.summary ?? "O agente quer executar uma ação que pode alterar ou enviar dados.";
      confirmationModal.hidden = false;
      confirmationApprove.focus();
      if (confirmationTimeout !== undefined) window.clearTimeout(confirmationTimeout);
      confirmationTimeout = window.setTimeout(() => {
        if (pendingConfirmation?.confirmationId !== confirmation.confirmationId) return;
        pendingConfirmation = undefined;
        confirmationModal.hidden = true;
        if (!activeRequestId) agentResult.textContent = "Confirmação expirou; a ação foi cancelada.";
      }, 60_000);
    }
  });

  const scanCurrentPage = (): Promise<PageState> => new Promise((resolve, reject) => {
    chromeApi.runtime.sendMessage({ type: "SCAN_PAGE", requestId: requestId() }, (response: ScanResponse | undefined) => {
      if (chromeApi.runtime.lastError || !response?.ok || !response.data) {
        reject(new Error(response?.error ?? "Não foi possível atualizar o pagemap."));
        return;
      }
      renderPageMap(response.data, "Pagemap atualizado para a aba ativa");
      resolve(response.data);
    });
  });

  const protectedControls = [status, pageState, debugOverlay.parentElement, agentControls, actionDebug, elements].filter((value): value is HTMLElement => value instanceof HTMLElement);
  const setConfiguredUi = (configured: boolean): void => {
    onboarding.hidden = configured;
    editKeyButton.hidden = !configured;
    for (const control of protectedControls) control.hidden = !configured;
  };
  setConfiguredUi(false);

  void chromeApi.storage.local.get("jevProvider").then((stored) => {
    const config = stored.jevProvider as { apiKey?: unknown } | undefined;
    if (typeof config?.apiKey === "string" && config.apiKey.trim().length > 0) setConfiguredUi(true);
  }).catch(() => { onboardingStatus.textContent = "Não foi possível ler a configuração da extensão."; });

  saveKeyButton.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) { onboardingStatus.textContent = "Insira uma API key para continuar."; return; }
    if (!apiKey.startsWith("apikey_")) { onboardingStatus.textContent = "A chave deve começar com apikey_."; return; }
    saveKeyButton.disabled = true;
    onboardingStatus.textContent = "Salvando…";
    void chromeApi.storage.local.set({ jevProvider: { id: "jev", endpoint: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", apiKey } }).then(() => {
      apiKeyInput.value = "";
      onboardingStatus.textContent = "Configurado. Você já pode usar o agente.";
      setConfiguredUi(true);
    }).catch(() => {
      onboardingStatus.textContent = "Não foi possível salvar a API key.";
    }).finally(() => { saveKeyButton.disabled = false; });
  });
  editKeyButton.addEventListener("click", () => {
    apiKeyInput.value = "";
    onboardingStatus.textContent = "Cole a nova API key da TypeSafe.";
    setConfiguredUi(false);
    apiKeyInput.focus();
  });

  const sendAction = (action: unknown): void => {
    actionResult.textContent = "Executando…";
    void chromeApi.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab.id === undefined) throw new Error("Aba ativa indisponível");
      return chromeApi.tabs.sendMessage(tab.id, { type: "EXECUTE_ACTION", actionId: requestId(), action });
    }).then((response: { ok?: boolean; code?: string; error?: string } | undefined) => {
      actionResult.textContent = response?.ok ? "Ação executada" : `${response?.code ?? "ERRO"}: ${response?.error ?? "falha"}`;
    }).catch((error: unknown) => { actionResult.textContent = error instanceof Error ? error.message : "Falha ao executar ação"; });
  };
  clickButton.addEventListener("click", () => sendAction({ type: "click", target: { ref: actionRef.value.trim() } }));
  typeButton.addEventListener("click", () => sendAction({ type: "type", target: { ref: actionRef.value.trim() }, text: actionText.value, replace: true }));
  let activeRequestId: string | undefined;
  const queuedVoiceGoals: string[] = [];
  const dispatchQueuedVoiceGoal = (): void => {
    if (activeRequestId || queuedVoiceGoals.length === 0) return;
    const nextGoal = queuedVoiceGoals.shift();
    if (!nextGoal) return;
    agentGoal.value = nextGoal;
    agentRun.click();
    agentGoal.value = "";
  };
  const enqueueVoiceGoal = (goal: string): void => {
    const normalized = goal.trim();
    if (!normalized) return;
    if (agentGoal.value.trim() === normalized) agentGoal.value = "";
    queuedVoiceGoals.push(normalized);
    if (activeRequestId) agentResult.textContent = `Comando de voz na fila (${queuedVoiceGoals.length}).`;
    dispatchQueuedVoiceGoal();
  };
  agentRun.addEventListener("click", () => {
    const goal = agentGoal.value.trim();
    if (!goal) { agentResult.textContent = "Informe um objetivo."; return; }
    activeRequestId = requestId();
    agentRun.disabled = true;
    agentCancel.disabled = false;
    const cancelLabel = agentCancel.querySelector("span");
    if (cancelLabel) cancelLabel.textContent = /\b(scrolle|scroll|role|rolar|rolando)\b/i.test(goal) && /\b(devagar|lentamente|continuamente|at[eé]\s+eu\s+mandar\s+parar)\b/i.test(goal) ? "Parar rolagem" : "Cancelar";
    agentResult.textContent = "Consultando Jev…";
    chromeApi.runtime.sendMessage({ type: "RUN_AGENT", requestId: activeRequestId, goal }, (response: { ok?: boolean; data?: { status?: string; steps?: unknown[]; message?: string }; error?: string } | undefined) => {
      agentRun.disabled = false;
      agentCancel.disabled = true;
      activeRequestId = undefined;
      window.setTimeout(dispatchQueuedVoiceGoal, 0);
      const cancelLabel = agentCancel.querySelector("span");
      if (cancelLabel) cancelLabel.textContent = "Cancelar";
      if (chromeApi.runtime.lastError || !response?.ok) {
        agentResult.textContent = response?.error ?? "Falha ao executar o agente.";
        return;
      }
      agentResult.textContent = `${response.data?.status ?? "concluído"}: ${response.data?.steps?.length ?? 0} passo(s). ${response.data?.message ?? ""}`;
    });
  });
  agentCancel.addEventListener("click", () => {
    if (!activeRequestId) return;
    const requestToCancel = activeRequestId;
    queuedVoiceGoals.length = 0;
    if (pendingConfirmation?.requestId === requestToCancel) resolveActionConfirmation(false);
    agentCancel.disabled = true;
    agentResult.textContent = "Cancelando…";
    chromeApi.runtime.sendMessage({ type: "CANCEL_AGENT", requestId: requestToCancel });
  });
  const resolveActionConfirmation = (approved: boolean): void => {
    if (!pendingConfirmation) return;
    const confirmation = pendingConfirmation;
    pendingConfirmation = undefined;
    if (confirmationTimeout !== undefined) window.clearTimeout(confirmationTimeout);
    confirmationTimeout = undefined;
    confirmationModal.hidden = true;
    chromeApi.runtime.sendMessage({
      type: "RESOLVE_AGENT_ACTION_CONFIRMATION",
      confirmationId: confirmation.confirmationId,
      requestId: confirmation.requestId,
      approved,
    });
  };
  confirmationApprove.addEventListener("click", () => resolveActionConfirmation(true));
  confirmationReject.addEventListener("click", () => resolveActionConfirmation(false));
  let voiceRecorder: SpeechRecognitionRecorder | undefined;
  const pendingVoiceSegments: string[] = [];
  let pendingVoiceSince: number | undefined;
  let lastVoiceFinalAt: number | undefined;
  let voiceFlushInterval: number | undefined;
  const minVoiceLetters = 4;
  const voiceQuietPeriodMs = 1200;
  const voiceMaxBufferMs = 5000;
  const voiceCheckIntervalMs = 3000;
  let voiceAudioContext: AudioContext | undefined;
  const normalizeSpeech = (text: string): string => text.replace(/\s+/g, " ").trim();
  const setVoiceListening = (listening: boolean): void => {
    voiceStart.classList.toggle("recording", listening);
    voiceStart.setAttribute("aria-pressed", String(listening));
    voiceStart.title = listening ? "Encerrar escuta" : "Começar a ouvir";
    voiceStart.setAttribute("aria-label", voiceStart.title);
    voiceStart.innerHTML = `<i data-lucide="${listening ? "mic-off" : "mic"}"></i>`;
    createIcons({ icons });
    voiceStatus.textContent = listening ? "Ouvindo" : "Microfone desligado";
    voiceStatus.classList.toggle("active", listening);
  };
  const playListeningCue = (): void => {
    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) return;
      voiceAudioContext ??= new AudioContextConstructor();
      if (voiceAudioContext.state === "suspended") void voiceAudioContext.resume();
      const oscillator = voiceAudioContext.createOscillator();
      const gain = voiceAudioContext.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, voiceAudioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, voiceAudioContext.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, voiceAudioContext.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(voiceAudioContext.destination);
      oscillator.start();
      oscillator.stop(voiceAudioContext.currentTime + 0.17);
    } catch { /* O indicador visual continua disponível se o áudio estiver indisponível. */ }
  };
  const isVoiceCommandLongEnough = (text: string): boolean => {
    const normalized = normalizeSpeech(text);
    const lettersAndNumbers = normalized.match(/[\p{L}\p{N}]/gu) ?? [];
    const meaningfulWords = normalized.split(/\s+/).filter((word) => (word.match(/[\p{L}]/gu) ?? []).length >= minVoiceLetters);
    return lettersAndNumbers.length >= minVoiceLetters && meaningfulWords.length > 0;
  };
  const clearVoiceTimers = (): void => {
    if (voiceFlushInterval !== undefined) window.clearInterval(voiceFlushInterval);
    voiceFlushInterval = undefined;
  };
  const flushVoiceBuffer = (force = false): boolean => {
    const text = normalizeSpeech(pendingVoiceSegments.join(" "));
    if (!text || !isVoiceCommandLongEnough(text)) return false;
    const now = Date.now();
    const quietEnough = lastVoiceFinalAt !== undefined && now - lastVoiceFinalAt >= voiceQuietPeriodMs;
    const waitedLongEnough = pendingVoiceSince !== undefined && now - pendingVoiceSince >= voiceMaxBufferMs;
    if (!force && !quietEnough && !waitedLongEnough) return false;
    pendingVoiceSegments.length = 0;
    pendingVoiceSince = undefined;
    lastVoiceFinalAt = undefined;
    if (normalizeSpeech(agentGoal.value) === text) agentGoal.value = "";
    enqueueVoiceGoal(text);
    return true;
  };
  const finalizeVoiceBuffer = (): void => {
    const text = normalizeSpeech(pendingVoiceSegments.join(" "));
    clearVoiceTimers();
    if (!text) return;
    if (flushVoiceBuffer(true)) return;
    pendingVoiceSegments.length = 0;
    pendingVoiceSince = undefined;
    lastVoiceFinalAt = undefined;
    if (!activeRequestId && queuedVoiceGoals.length === 0) agentResult.textContent = "Trecho curto ignorado; fale um comando mais completo.";
  };
  const startSpeech = (): void => {
    voiceStart.disabled = true;
    voiceStatus.textContent = "Iniciando microfone…";
    agentGoal.value = "";
    agentResult.textContent = "Iniciando reconhecimento de voz do Chrome…";
    try {
      if (window.AudioContext) {
        voiceAudioContext ??= new window.AudioContext();
        if (voiceAudioContext.state === "suspended") void voiceAudioContext.resume();
      }
      voiceRecorder = startChromeSpeechRecognition((text) => {
        agentGoal.value = normalizeSpeech(`${pendingVoiceSegments.join(" ")} ${text}`);
      }, (segment) => {
        const normalized = normalizeSpeech(segment);
        if (!normalized) return;
        pendingVoiceSegments.push(normalized);
        agentGoal.value = normalizeSpeech(pendingVoiceSegments.join(" "));
        const now = Date.now();
        pendingVoiceSince ??= now;
        lastVoiceFinalAt = now;
      }, (statusText) => {
        if (statusText.includes("está ouvindo")) {
          setVoiceListening(true);
          playListeningCue();
        } else if (statusText) {
          voiceStatus.textContent = statusText;
          voiceStatus.classList.remove("active");
        }
        if (!activeRequestId && queuedVoiceGoals.length === 0) agentResult.textContent = statusText;
      }, () => {
        clearVoiceTimers();
        voiceRecorder = undefined;
        voiceStart.disabled = false;
        setVoiceListening(false);
        finalizeVoiceBuffer();
      });
      voiceFlushInterval = window.setInterval(() => { flushVoiceBuffer(); }, voiceCheckIntervalMs);
      voiceStart.disabled = false;
    } catch (error) {
      voiceRecorder = undefined;
      clearVoiceTimers();
      voiceStart.disabled = false;
      setVoiceListening(false);
      voiceStatus.textContent = error instanceof Error ? error.message : "Não foi possível iniciar o microfone.";
      agentResult.textContent = error instanceof Error ? error.message : "Não foi possível iniciar a transcrição.";
    }
  };
  const stopSpeech = (): void => {
    const recorder = voiceRecorder;
    if (!recorder) return;
    voiceStart.disabled = true;
    voiceStatus.textContent = "Encerrando escuta…";
    agentResult.textContent = "Finalizando transcrição…";
    void recorder.stop().then((text) => {
      if (voiceRecorder === recorder) {
        clearVoiceTimers();
        voiceRecorder = undefined;
        voiceStart.disabled = false;
        setVoiceListening(false);
        finalizeVoiceBuffer();
      }
      if (!activeRequestId && queuedVoiceGoals.length === 0 && !text) agentResult.textContent = "Nenhuma fala suficiente para enviar.";
    }).catch((error: unknown) => {
      clearVoiceTimers();
      voiceRecorder = undefined;
      voiceStart.disabled = false;
      setVoiceListening(false);
      voiceStatus.textContent = error instanceof Error ? error.message : "Não foi possível acessar o microfone.";
      agentResult.textContent = error instanceof Error ? error.message : "Não foi possível transcrever o áudio.";
    });
  };
  voiceStart.addEventListener("click", () => {
    if (voiceRecorder) stopSpeech();
    else startSpeech();
  });

  debugOverlay.addEventListener("change", () => {
    void chromeApi.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab.id !== undefined) void chromeApi.tabs.sendMessage(tab.id, { type: "SCANNER_OVERLAY", enabled: debugOverlay.checked });
    });
  });

  status.textContent = "Inspecionando a página ativa…";
  chromeApi.runtime.sendMessage({ type: "SCAN_PAGE", requestId: requestId() }, (response: ScanResponse | undefined) => {
    if (chromeApi.runtime.lastError || !response?.ok || !response.data) {
      status.textContent = response?.error ?? "Não foi possível inspecionar esta página.";
      return;
    }
    renderPageMap(response.data, "Página conectada");
  });
}
