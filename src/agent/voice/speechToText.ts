import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

// O tiny é muito leve, mas costuma errar bastante em português. O base é
// mais pesado e lento na primeira execução, porém entrega uma transcrição
// significativamente mais confiável.
export const STT_MODEL_ID = "onnx-community/whisper-base";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm!.wasmPaths = {
  mjs: chrome.runtime.getURL("ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: chrome.runtime.getURL("ort-wasm-simd-threaded.asyncify.wasm"),
};

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | undefined;

export interface SpeechToTextProgress {
  status: string;
  progress?: number;
}

function getDevice(): "wasm" {
  // Whisper quantizado (q8) é mais compatível no WASM do que no WebGPU,
  // especialmente em páginas de extensão com CSP restritiva.
  return "wasm";
}

export async function loadSpeechToText(onProgress?: (progress: SpeechToTextProgress) => void): Promise<void> {
  if (!transcriberPromise) {
    const device = getDevice();
    transcriberPromise = pipeline("automatic-speech-recognition", STT_MODEL_ID, {
        device,
        dtype: "q8",
        progress_callback: (event: { status?: string; progress?: number }) => onProgress?.({ status: event.status ?? "carregando", progress: event.progress }),
      }) as Promise<AutomaticSpeechRecognitionPipeline>;
    transcriberPromise = transcriberPromise.catch((error: unknown) => {
      transcriberPromise = undefined;
      throw new Error(`Não foi possível carregar o modelo Whisper: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    });
  }
  await transcriberPromise;
}

export async function transcribeAudio(audio: Float32Array, onProgress?: (progress: SpeechToTextProgress) => void): Promise<string> {
  await loadSpeechToText(onProgress);
  const transcriber = await transcriberPromise!;
  let peak = 0;
  for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
  const normalized = peak > 0.01 && peak < 0.95 ? audio.map((sample) => sample * (0.9 / peak)) : audio;
  const output = await transcriber(normalized, { language: "portuguese", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
  return output.text.trim();
}

export function resetSpeechToText(): void {
  transcriberPromise = undefined;
}
