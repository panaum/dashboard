// Keyboard movement inside a picker. Pure, so the wrapping is tested rather
// than eyeballed.
//
// Both pickers are single-select, so they are radio groups: one tab stop for
// the whole set, arrow keys move between the options and select as they go,
// Home and End jump to the ends. Fourteen devices behind fourteen tab stops
// is not "reachable by keyboard", it is a tax on everyone using one.

/** The index an arrow key moves to, or null when the key is not the picker's. */
export function rovingTarget(key: string, current: number, count: number): number | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const i = Math.max(0, Math.min(count - 1, Math.floor(current) || 0));
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (i + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (i - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
