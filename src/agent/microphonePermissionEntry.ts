async function requestMicrophonePermission(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    document.querySelector<HTMLElement>("#status")!.textContent = "Microfone permitido. Esta aba será fechada.";
    chrome.runtime.sendMessage({ type: "MIC_PERMISSION_RESULT", ok: true });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    const message = name === "NotAllowedError" ? "O acesso foi negado no Chrome." : "Não foi possível acessar o microfone.";
    document.querySelector<HTMLElement>("#status")!.textContent = `${message} Feche esta aba e tente novamente.`;
    chrome.runtime.sendMessage({ type: "MIC_PERMISSION_RESULT", ok: false, error: message });
  }
}

void requestMicrophonePermission();
