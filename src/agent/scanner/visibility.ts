export function isElementVisible(element: HTMLElement, viewport: Pick<Window, "innerWidth" | "innerHeight">): boolean {
  const view = element.ownerDocument.defaultView ?? window;
  const style = view.getComputedStyle(element);
  if (element.hidden || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let left = Math.max(rect.left, 0);
  let top = Math.max(rect.top, 0);
  let right = Math.min(rect.right, viewport.innerWidth);
  let bottom = Math.min(rect.bottom, viewport.innerHeight);
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor === element.ownerDocument.body || ancestor === element.ownerDocument.documentElement) continue;
    const ancestorStyle = view.getComputedStyle(ancestor);
    if (ancestorStyle.display === "none" || ancestorStyle.visibility === "hidden" || ancestor.inert || ancestor.getAttribute("aria-hidden") === "true") return false;
    if (ancestorStyle.opacity === "0") return false;
    if (/hidden|clip|scroll|auto/.test(`${ancestorStyle.overflow} ${ancestorStyle.overflowX} ${ancestorStyle.overflowY}`)) {
      const clip = ancestor.getBoundingClientRect();
      left = Math.max(left, clip.left);
      top = Math.max(top, clip.top);
      right = Math.min(right, clip.right);
      bottom = Math.min(bottom, clip.bottom);
    }
  }
  return right > left && bottom > top;
}
