import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export const STT_MODEL_ID = "onnx-community/whisper-tiny";

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | undefined;

export interface SpeechToTextProgress {
  status: string;
  progress?: number;
}

function getDevice(): "webgpu" | "wasm" {
  return "gpu" in navigator ? "webgpu" : "wasm";
}

export async function loadSpeechToText(onProgress?: (progress: SpeechToTextProgress) => void): Promise<void> {
  if (!transcriberPromise) {
    const device = getDevice();
    transcriberPromise = pipeline("automatic-speech-recognition", STT_MODEL_ID, {
      device,
      dtype: "q8",
      progress_callback: (event: { status?: string; progress?: number }) => onProgress?.({ status: event.status ?? "carregando", progress: event.progress }),
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
  }
  await transcriberPromise;
}

export async function transcribeAudio(audio: Float32Array, onProgress?: (progress: SpeechToTextProgress) => void): Promise<string> {
  await loadSpeechToText(onProgress);
  const transcriber = await transcriberPromise!;
  const output = await transcriber(audio, { language: "portuguese", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
  return output.text.trim();
}

export function resetSpeechToText(): void {
  transcriberPromise = undefined;
}
