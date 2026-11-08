export const CLICK_DRAG_THRESHOLD_PX = 6;

export function exceedsClickDragThreshold(
  start: Readonly<{ x: number; y: number }>,
  current: Readonly<{ x: number; y: number }>,
  threshold = CLICK_DRAG_THRESHOLD_PX,
): boolean {
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;
  return deltaX * deltaX + deltaY * deltaY >= threshold * threshold;
}
