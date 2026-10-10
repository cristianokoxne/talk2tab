import type { ElementRef, ScrollContainerRef } from "../types.js";
import { ElementRegistry } from "../registry/elementRegistry.js";

const overlayId = "voice-browser-agent-debug-overlay";

export function removeDebugOverlay(document: Document): void {
  document.getElementById(overlayId)?.remove();
}

export function showDebugOverlay(document: Document, registry: ElementRegistry, elements: ElementRef[], scrollContainers: ScrollContainerRef[] = [], refPrefix = ""): number {
  removeDebugOverlay(document);
  const root = document.createElement("div");
  root.id = overlayId;
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const markers = [
    ...elements.map((item) => ({ ref: `${refPrefix}${item.ref}`, node: registry.get(item.ref), kind: "element" as const })),
    ...scrollContainers.map((item) => ({ ref: `${refPrefix}${item.ref}`, node: registry.get(item.ref), kind: "scroll" as const })),
  ];
  for (const item of markers) {
    if (!item.node) continue;
    const rect = item.node.getBoundingClientRect();
    const marker = document.createElement("div");
    marker.textContent = item.ref;
    marker.dataset.ref = item.ref;
    marker.dataset.kind = item.kind;
    marker.style.cssText = item.kind === "scroll"
      ? `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;outline:2px dashed #f59e0b;background:rgba(245,158,11,.08);color:#fff;font:12px sans-serif`
      : `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;outline:2px solid #7c3aed;background:rgba(124,58,237,.12);color:#fff;font:12px sans-serif`;
    root.append(marker);
  }
  document.documentElement.append(root);
  return root.querySelectorAll("[data-ref]").length;
}
