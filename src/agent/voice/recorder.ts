import { transcribeAudio, type SpeechToTextProgress } from "./speechToText.js";

export interface VoiceRecorder {
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

export async function startVoiceRecorder(onProgress?: (progress: SpeechToTextProgress) => void): Promise<VoiceRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size > 0) chunks.push(event.data); });
  recorder.start();
  return {
    stop: () => new Promise<string>((resolve, reject) => {
      recorder.addEventListener("stop", () => {
        void (async () => {
          try {
            const context = new AudioContext();
            const buffer = await context.decodeAudioData(await new Blob(chunks).arrayBuffer());
            const mono = new Float32Array(buffer.length);
            for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
              const samples = buffer.getChannelData(channel);
              for (let index = 0; index < samples.length; index += 1) mono[index] += samples[index] / buffer.numberOfChannels;
            }
            const audio = resample(mono, buffer.sampleRate, 16_000);
            resolve(await transcribeAudio(audio, onProgress));
            await context.close();
          } catch (error) { reject(error); }
          finally { stream.getTracks().forEach((track) => track.stop()); }
        })();
      }, { once: true });
      recorder.stop();
    }),
  };
}
