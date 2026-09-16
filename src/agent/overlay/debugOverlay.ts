import type { ElementRef } from "../types.js";
import { ElementRegistry } from "../registry/elementRegistry.js";

const overlayId = "voice-browser-agent-debug-overlay";

export function removeDebugOverlay(document: Document): void {
  document.getElementById(overlayId)?.remove();
}

export function showDebugOverlay(document: Document, registry: ElementRegistry, elements: ElementRef[]): void {
  removeDebugOverlay(document);
  const root = document.createElement("div");
  root.id = overlayId;
  root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  for (const item of elements) {
    const element = registry.get(item.ref);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const marker = document.createElement("div");
    marker.textContent = item.ref;
    marker.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;outline:2px solid #7c3aed;background:rgba(124,58,237,.12);color:#fff;font:12px sans-serif`;
    root.append(marker);
  }
  document.documentElement.append(root);
}
