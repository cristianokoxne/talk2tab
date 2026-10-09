import type { PageState } from "./types.js";

export interface EffectWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  quietWindowMs?: number;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Wait cancelled.")); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, ms);
    const aborted = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", aborted); reject(new Error("Wait cancelled.")); };
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

/** Polls a semantic condition; DOM churn is bounded by a hard timeout and a short stability window. */
export async function waitForPageEffect(
  observe: () => Promise<PageState>,
  before: PageState,
  signal?: AbortSignal,
  options: EffectWaitOptions = {},
): Promise<PageState> {
  const timeoutMs = Math.max(100, options.timeoutMs ?? 3_000);
  const pollIntervalMs = Math.max(20, options.pollIntervalMs ?? 50);
  const quietWindowMs = Math.max(50, options.quietWindowMs ?? 120);
  const startedAt = Date.now();
  let latest = before;
  let lastFingerprint: string | undefined;
  let lastUrl: string | undefined;
  let stableSince: number | undefined;
  let observationRetries = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await delay(Math.min(pollIntervalMs, timeoutMs - (Date.now() - startedAt)), signal);
    try {
      latest = await observe();
      observationRetries = 0;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (observationRetries >= 2) throw error;
      await delay([100, 250][observationRetries], signal);
      observationRetries += 1;
      continue;
    }
    if (latest.url === before.url && latest.fingerprint === before.fingerprint) {
      lastFingerprint = undefined;
      stableSince = undefined;
      continue;
    }
    if (latest.fingerprint !== lastFingerprint || latest.url !== lastUrl) {
      lastFingerprint = latest.fingerprint;
      lastUrl = latest.url;
      stableSince = Date.now();
      continue;
    }
    if (stableSince !== undefined && Date.now() - stableSince >= quietWindowMs) return latest;
  }
  return latest;
}
