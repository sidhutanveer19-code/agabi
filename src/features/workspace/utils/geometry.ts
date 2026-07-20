import type { Rect } from "@/features/workspace/types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Axis-aligned rectangle intersection test (used for virtualization culling). */
export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Grow a rect by a uniform margin on all sides. */
export function inflateRect(r: Rect, margin: number): Rect {
  return { x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 };
}

/** Bounding rect that contains all given rects (empty → null). */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
