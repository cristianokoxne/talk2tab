import type { PageState } from "./types.js";
import { startWhisperLiveRecorder, type SpeechRecognitionRecorder } from "./voice/recorder.js";
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
  const voiceConfig = document.querySelector<HTMLButtonElement>("#voice-config");
  const voiceStop = document.querySelector<HTMLButtonElement>("#voice-stop");
  const agentResult = document.querySelector<HTMLOutputElement>("#agent-result");
  const voiceDeviceModal = document.querySelector<HTMLElement>("#voice-device-modal");
  const voiceDeviceSelect = document.querySelector<HTMLSelectElement>("#voice-device-select");
  const voiceDeviceClose = document.querySelector<HTMLButtonElement>("#voice-device-close");
  const voiceDeviceCancel = document.querySelector<HTMLButtonElement>("#voice-device-cancel");
  const voiceDeviceConfirm = document.querySelector<HTMLButtonElement>("#voice-device-confirm");
  const voiceDeviceStatus = document.querySelector<HTMLOutputElement>("#voice-device-status");
  const voiceMeterLevel = document.querySelector<HTMLElement>("#voice-meter-level");
  const onboarding = document.querySelector<HTMLElement>("#jev-onboarding");
  const apiKeyInput = document.querySelector<HTMLInputElement>("#jev-api-key");
  const saveKeyButton = document.querySelector<HTMLButtonElement>("#jev-save-key");
  const onboardingStatus = document.querySelector<HTMLOutputElement>("#jev-onboarding-status");
  const editKeyButton = document.querySelector<HTMLButtonElement>("#jev-edit-key");
  if (!status || !pageState || !elements || !debugOverlay || !actionRef || !actionText || !actionResult || !actionDebug || !clickButton || !typeButton || !agentGoal || !agentControls || !agentRun || !agentCancel || !voiceStart || !voiceConfig || !voiceStop || !agentResult || !voiceDeviceModal || !voiceDeviceSelect || !voiceDeviceClose || !voiceDeviceCancel || !voiceDeviceConfirm || !voiceDeviceStatus || !voiceMeterLevel || !onboarding || !apiKeyInput || !saveKeyButton || !onboardingStatus || !editKeyButton) return;
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
    if (typeof message !== "object" || message === null || (message as AgentPageStateMessage).type !== "AGENT_PAGE_STATE") return;
    const update = message as AgentPageStateMessage;
    renderPageMap(update.data, `Pagemap atualizado · passo ${update.step} · ${update.data.elements.length} refs`);
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
    agentCancel.disabled = true;
    agentResult.textContent = "Cancelando…";
    chromeApi.runtime.sendMessage({ type: "CANCEL_AGENT", requestId: activeRequestId });
  });
  let voiceRecorder: SpeechRecognitionRecorder | undefined;
  interface SavedMicrophone { deviceId: string; label: string; }
  let savedMicrophone: SavedMicrophone | undefined;
  void chromeApi.storage.local.get("voiceMicrophone").then((stored) => {
    savedMicrophone = stored.voiceMicrophone as SavedMicrophone | undefined;
  });
  let microphoneTestStream: MediaStream | undefined;
  let microphoneTestContext: AudioContext | undefined;
  let microphoneTestFrame: number | undefined;
  const closeVoiceDeviceModal = (): void => {
    if (microphoneTestFrame !== undefined) cancelAnimationFrame(microphoneTestFrame);
    microphoneTestStream?.getTracks().forEach((track) => track.stop());
    microphoneTestStream = undefined;
    void microphoneTestContext?.close();
    microphoneTestContext = undefined;
    voiceDeviceModal.hidden = true;
  };
  const openVoiceDeviceModal = async (): Promise<void> => {
    voiceDeviceStatus.textContent = "Detectando microfones…";
    voiceDeviceSelect.replaceChildren();
    voiceDeviceModal.hidden = false;
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      devices.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Microfone ${index + 1}`;
        voiceDeviceSelect.append(option);
      });
      if (devices.length === 0) throw new Error("Nenhum microfone foi encontrado.");
      const stored = await chromeApi.storage.local.get("voiceMicrophone");
      const saved = stored.voiceMicrophone as SavedMicrophone | undefined;
      if (saved?.deviceId && devices.some((device) => device.deviceId === saved.deviceId)) voiceDeviceSelect.value = saved.deviceId;
      voiceDeviceStatus.textContent = "Fale agora para testar o microfone selecionado.";
      const testSelectedDevice = async (): Promise<void> => {
        microphoneTestStream?.getTracks().forEach((track) => track.stop());
        microphoneTestStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: voiceDeviceSelect.value } } });
        microphoneTestContext = new AudioContext();
        const analyser = microphoneTestContext.createAnalyser();
        analyser.fftSize = 512;
        microphoneTestContext.createMediaStreamSource(microphoneTestStream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const drawLevel = (): void => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
          voiceMeterLevel.style.transform = `scaleX(${Math.min(1, peak / 64)})`;
          microphoneTestFrame = requestAnimationFrame(drawLevel);
        };
        drawLevel();
      };
      await testSelectedDevice();
      voiceDeviceSelect.addEventListener("change", () => { void testSelectedDevice(); }, { once: true });
    } catch (error) {
      voiceDeviceStatus.textContent = error instanceof Error ? error.message : "Não foi possível acessar os microfones.";
    }
  };
  const startSpeech = (): void => {
    closeVoiceDeviceModal();
    voiceStart.disabled = true;
    voiceStop.disabled = true;
    agentResult.textContent = "Iniciando transcrição…";
    if (!savedMicrophone?.deviceId) {
      voiceStart.disabled = false;
      agentResult.textContent = "Configure o microfone no botão de configurações antes de ouvir.";
      return;
    }
    void startWhisperLiveRecorder(savedMicrophone.deviceId, (text) => {
      agentGoal.value = text;
      agentResult.textContent = "Transcrição parcial…";
    }, (statusText) => {
      agentResult.textContent = statusText;
    }).then((recorder) => {
      voiceRecorder = recorder;
      voiceStop.disabled = false;
    }).catch((error: unknown) => {
      voiceStart.disabled = false;
      voiceStop.disabled = true;
      agentResult.textContent = error instanceof Error ? error.message : "Não foi possível iniciar a transcrição.";
    });
  };
  voiceStart.addEventListener("click", startSpeech);
  voiceConfig.addEventListener("click", () => { void openVoiceDeviceModal(); });
  voiceDeviceClose.addEventListener("click", closeVoiceDeviceModal);
  voiceDeviceCancel.addEventListener("click", closeVoiceDeviceModal);
  voiceDeviceConfirm.addEventListener("click", () => {
    const selected = voiceDeviceSelect.selectedOptions[0];
    if (!selected) { voiceDeviceStatus.textContent = "Selecione um microfone."; return; }
    void chromeApi.storage.local.set({ voiceMicrophone: { deviceId: selected.value, label: selected.textContent ?? "Microfone" } }).then(() => {
      savedMicrophone = { deviceId: selected.value, label: selected.textContent ?? "Microfone" };
      voiceDeviceStatus.textContent = `Salvo: ${selected.textContent ?? "microfone"}.`;
      setTimeout(closeVoiceDeviceModal, 500);
    }).catch(() => { voiceDeviceStatus.textContent = "Não foi possível salvar o microfone."; });
  });
  voiceStop.addEventListener("click", () => {
    if (!voiceRecorder) return;
    voiceStop.disabled = true;
    agentResult.textContent = "Finalizando transcrição…";
    void voiceRecorder.stop().then((text) => {
      voiceRecorder = undefined;
      voiceStart.disabled = false;
      agentGoal.value = text;
      agentResult.textContent = text ? "Transcrição pronta. Revise e execute com Jev." : "Nenhuma fala detectada.";
    }).catch((error: unknown) => {
      voiceRecorder = undefined;
      voiceStart.disabled = false;
      agentResult.textContent = error instanceof Error ? error.message : "Não foi possível transcrever o áudio.";
    });
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
