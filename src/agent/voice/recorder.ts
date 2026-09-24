import { transcribeAudio } from "./speechToText.js";

export interface SpeechRecognitionRecorder {
  stop(): Promise<string>;
}

function resample(channel: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return channel;
  const length = Math.round(channel.length * toRate / fromRate);
  const result = new Float32Array(length);
  const ratio = (channel.length - 1) / Math.max(length - 1, 1);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(Math.ceil(position), channel.length - 1);
    const weight = position - left;
    result[index] = channel[left] * (1 - weight) + channel[right] * weight;
  }
  return result;
}

function normalize(audio: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
  return peak > 0.01 && peak < 0.95 ? audio.map((sample) => sample * (0.9 / peak)) : audio;
}

function hasSpeech(audio: Float32Array): boolean {
  let sum = 0;
  for (const sample of audio) sum += sample * sample;
  return Math.sqrt(sum / Math.max(audio.length, 1)) > 0.008;
}

export async function startWhisperLiveRecorder(
  deviceId: string,
  onTranscript: (text: string) => void,
  onStatus?: (status: string) => void,
): Promise<SpeechRecognitionRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("O navegador não oferece acesso ao microfone.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const sampleRate = context.sampleRate;
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  const samples: number[] = [];
  let stopped = false;
  let transcribing = false;
  const timer = window.setInterval(() => { void transcribePartial(); }, 2500);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    for (const sample of input) samples.push(sample);
  };
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(context.destination);
  onStatus?.("Microfone selecionado e capturando áudio…");

  const snapshot = (maxSeconds?: number): Float32Array => {
    const all = new Float32Array(samples);
    const maxSamples = maxSeconds ? Math.round(maxSeconds * sampleRate) : all.length;
    return all.length > maxSamples ? all.slice(all.length - maxSamples) : all;
  };
  const transcribePartial = async (): Promise<void> => {
    if (stopped || transcribing) return;
    const audio = snapshot(8);
    if (audio.length < sampleRate * 0.7 || !hasSpeech(audio)) return;
    transcribing = true;
    try {
      onStatus?.("Processando trecho com Whisper…");
      const text = await transcribeAudio(normalize(resample(audio, sampleRate, 16_000)), (progress) => {
        if (progress.status) onStatus?.(progress.progress ? `${progress.status} ${Math.round(progress.progress)}%` : progress.status);
      });
      if (text) onTranscript(text);
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Falha ao processar trecho de áudio.");
    } finally {
      transcribing = false;
    }
  };
  return {
    stop: async () => {
      if (stopped) return "";
      stopped = true;
      window.clearInterval(timer);
      processor.disconnect();
      source.disconnect();
      silentGain.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => undefined);
      const audio = snapshot();
      if (!hasSpeech(audio)) return "";
      onStatus?.("Finalizando transcrição com Whisper…");
      return transcribeAudio(normalize(resample(audio, sampleRate, 16_000)));
    },
  };
}
