export interface SpeechRecognitionRecorder {
  stop(): Promise<string>;
}

interface RecognitionAlternativeLike {
  transcript: string;
}

interface RecognitionResultLike {
  isFinal: boolean;
  0: RecognitionAlternativeLike;
}

interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}

interface RecognitionErrorLike extends Event {
  error?: string;
}

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: (() => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionConstructor = new () => RecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

const ERROR_MESSAGES: Record<string, string> = {
  "audio-capture": "O Chrome não conseguiu acessar um microfone.",
  "language-not-supported": "O Chrome não oferece reconhecimento para português do Brasil neste dispositivo.",
  network: "O reconhecimento de voz do Chrome falhou por causa da conexão.",
  "no-speech": "Nenhuma fala foi detectada. Tente novamente.",
  "not-allowed": "Permita que o Chrome acesse o microfone para usar a transcrição.",
  "service-not-allowed": "O serviço de reconhecimento de voz do Chrome não está permitido.",
};

function getRecognitionConstructor(): RecognitionConstructor | undefined {
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

export function startChromeSpeechRecognition(
  onInterim: (text: string) => void,
  onFinalSegment: (text: string) => void,
  onStatus?: (status: string) => void,
  onEnded?: () => void,
): SpeechRecognitionRecorder {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) throw new Error("Este navegador não oferece reconhecimento de fala. Abra o painel no Google Chrome.");

  const recognition = new Recognition();
  recognition.lang = "pt-BR";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalTranscript = "";
  let seenFinalIndexes = new Set<number>();
  let stopping = false;
  let settled = false;
  let resolveStopped: ((text: string) => void) | undefined;

  const stopped = new Promise<string>((resolve) => {
    resolveStopped = resolve;
  });

  const finish = (): void => {
    if (settled) return;
    settled = true;
    resolveStopped?.(finalTranscript.trim());
    onEnded?.();
  };

  recognition.onstart = () => {
    seenFinalIndexes = new Set<number>();
    onStatus?.("O Chrome está ouvindo em português (Brasil)…");
  };
  recognition.onresult = (event) => {
    let interimTranscript = "";
    const newFinalSegments: string[] = [];
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript?.trim();
      if (!transcript) continue;
      if (result.isFinal) {
        if (index >= event.resultIndex && !seenFinalIndexes.has(index)) {
          seenFinalIndexes.add(index);
          newFinalSegments.push(transcript);
          finalTranscript = `${finalTranscript} ${transcript}`.trim();
        }
      } else interimTranscript = `${interimTranscript} ${transcript}`.trim();
    }
    const newFinalText = newFinalSegments.join(" ").trim();
    if (newFinalText) onFinalSegment(newFinalText);
    onInterim(interimTranscript.trim());
  };
  recognition.onerror = (event) => {
    const message = ERROR_MESSAGES[event.error ?? ""] ?? `Erro no reconhecimento de voz do Chrome: ${event.error ?? "desconhecido"}.`;
    onStatus?.(message);
    stopping = true;
  };
  recognition.onend = () => {
    if (stopping) finish();
    else {
      // Chrome pode encerrar uma sessão contínua após silêncio ou um corte interno.
      // Reinicia apenas a captura iniciada explicitamente pelo usuário.
      try { recognition.start(); }
      catch {
        stopping = true;
        onStatus?.("A captura de voz foi encerrada.");
        finish();
      }
    }
  };

  try {
    recognition.start();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Não foi possível iniciar o reconhecimento de voz do Chrome.");
  }

  return {
    stop: () => {
      if (settled) return stopped;
      if (!stopping) {
        stopping = true;
        onStatus?.("Finalizando a transcrição…");
        try { recognition.stop(); }
        catch { finish(); }
      }
      return stopped;
    },
  };
}
