import type { Region, Size, Vec2 } from "@/features/workspace/types";
import { rectIntersects } from "@/features/workspace/utils/geometry";

/** Default explanation-region footprint. */
export const DEFAULT_REGION_SIZE: Size = { w: 640, h: 460 };

const GAP = 48;
/** Wrap to a new row after this world width so regions read left→right, top→down. */
const ROW_WIDTH = 2400;
const STEP = 40;

/**
 * Find a world-space slot for a new region that does NOT overlap any existing
 * region. This is what makes the multiple-explanation model safe: a new
 * explanation is always placed beside the old ones, never on top of them.
 *
 * Scans in reading order (row by row) for the first free slot.
 */
export function placeRegion(existing: Region[], size: Size): Vec2 {
  if (existing.length === 0) return { x: 0, y: 0 };

  const rowHeight = size.h + GAP;
  const maxCols = Math.max(1, Math.floor(ROW_WIDTH / (size.w + GAP)));

  for (let row = 0; row < 10_000; row++) {
    for (let col = 0; col < maxCols; col++) {
      const candidate = { x: col * (size.w + GAP), y: row * rowHeight };
      const rect = { ...candidate, w: size.w, h: size.h };
      const collides = existing.some((r) =>
        rectIntersects(rect, { x: r.position.x, y: r.position.y, w: r.size.w, h: r.size.h })
      );
      if (!collides) return candidate;
    }
  }

  // Fallback (unreachable in practice): stack below everything.
  const lowest = existing.reduce((m, r) => Math.max(m, r.position.y + r.size.h), 0);
  return { x: 0, y: lowest + STEP };
}
