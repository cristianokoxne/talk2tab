export function isElementVisible(element: HTMLElement, viewport: Pick<Window, "innerWidth" | "innerHeight">): boolean {
  const style = (element.ownerDocument.defaultView ?? window).getComputedStyle(element);
  if (element.hidden || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewport.innerHeight && rect.left < viewport.innerWidth;
}
