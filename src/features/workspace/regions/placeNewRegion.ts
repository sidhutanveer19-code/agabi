import type { Region, Size, Vec2 } from "@/features/workspace/types";
import { inflateRect, rectIntersects } from "@/features/workspace/utils/geometry";

/**
 * Choose a non-overlapping world position for a NEW region so that a new
 * explanation never covers an existing one. Scans in reading order (left→right,
 * top→bottom) for the first free slot.
 */
export function placeNewRegion(regions: Region[], size: Size, gap = 80): Vec2 {
  if (regions.length === 0) return { x: 0, y: 0 };

  const occupied = regions.map((r) =>
    inflateRect({ x: r.position.x, y: r.position.y, w: r.size.w, h: r.size.h }, gap / 2)
  );
  const rowHeight = Math.round(size.h + gap);
  const rowWidth = 2600;
  const step = 40;

  for (let y = 0; y < 1_000_000; y += rowHeight) {
    for (let x = 0; x <= rowWidth; x += step) {
      const candidate = { x, y, w: size.w, h: size.h };
      if (!occupied.some((o) => rectIntersects(candidate, o))) {
        return { x, y };
      }
    }
  }

  // Fallback: below everything.
  const maxBottom = Math.max(...regions.map((r) => r.position.y + r.size.h));
  return { x: 0, y: maxBottom + gap };
}
