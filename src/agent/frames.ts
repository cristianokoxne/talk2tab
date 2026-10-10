import type { ElementRef, FrameInfo, PageRegion, PageState, ScrollContainerRef } from "./types.js";

export interface LocalFrameObservation { frame: FrameInfo; state: PageState; }

export function frameScopedRef(frameId: number, localRef: string): string {
  return `fr${frameId}__${localRef}`;
}

export function parseFrameScopedRef(ref: string): { frameId: number; localRef: string } | undefined {
  const match = ref.match(/^fr(\d+)__(.+)$/);
  return match ? { frameId: Number(match[1]), localRef: match[2] } : undefined;
}

function frameLabel(frame: FrameInfo): string {
  const title = frame.title.trim();
  let origin = frame.url;
  try {
    const url = new URL(frame.url);
    origin = url.origin;
  } catch { /* Non-HTTP frame URLs are intentionally kept opaque. */ }
  return title ? `iframe “${title}” (${origin})` : `iframe (${origin})`;
}

export function aggregateFrameObservations(observations: LocalFrameObservation[], missingEmbeddedCount = 0): PageState {
  const ordered = [...observations].sort((a, b) => Number(b.frame.frameId === 0) - Number(a.frame.frameId === 0));
  const top = ordered.find((observation) => observation.frame.frameId === 0)?.state ?? ordered[0]?.state;
  if (!top) throw new Error("No accessible frame observation is available.");
  const elements: ElementRef[] = [];
  const scrollContainers: ScrollContainerRef[] = [];
  const regions: PageRegion[] = [];
  const focused = ordered.find(({ state }) => state.focusedElement);
  const limitations = ordered.flatMap(({ state }) => state.limitations);
  for (const { frame, state } of ordered) {
    const label = frame.frameId === 0 ? undefined : frameLabel(frame);
    for (const element of state.elements) {
      elements.push({
        ...element,
        ref: frameScopedRef(frame.frameId, element.ref),
        frameId: frame.frameId,
        context: [label, element.context].filter(Boolean).join(" — ") || undefined,
      });
    }
    for (const container of state.scrollContainers ?? []) {
      scrollContainers.push({ ...container, ref: frameScopedRef(frame.frameId, container.ref), frameId: frame.frameId, context: [label, container.context].filter(Boolean).join(" — ") || undefined });
    }
    for (const region of state.regions ?? []) regions.push({ ...region, name: label ? `${label}${region.name ? ` — ${region.name}` : ""}` : region.name });
  }
  if (missingEmbeddedCount > 0) limitations.push("one_or_more_embedded_frames_unavailable_or_sandboxed");
  const frameDescriptions = ordered.filter(({ frame }) => frame.frameId !== 0)
    .map(({ frame, state }) => `${frameLabel(frame)}: ${state.pageTextSummary}`);
  const states = ordered.map(({ frame, state }) => `${frame.frameId}:${state.fingerprint}`).join("|");
  return {
    ...top,
    elements,
    scrollContainers,
    regions,
    pageTextSummary: [top.pageTextSummary, ...frameDescriptions].filter(Boolean).join("\n").slice(0, 6000),
    focusedElement: focused ? frameScopedRef(focused.frame.frameId, focused.state.focusedElement!) : undefined,
    focusedFrameId: focused?.frame.frameId,
    activeDialog: ordered.find(({ state }) => state.activeDialog)?.frame.frameId === 0
      ? top.activeDialog
      : (() => {
          const entry = ordered.find(({ state }) => state.activeDialog);
          return entry ? `${frameLabel(entry.frame)} — ${entry.state.activeDialog}` : undefined;
        })(),
    frames: ordered.map(({ frame }) => frame),
    limitations: [...new Set(limitations)],
    fingerprint: `frames_${states}`,
  };
}
