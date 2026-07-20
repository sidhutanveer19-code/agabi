import type { Camera, Rect, Size, Vec2 } from "@/features/workspace/types";
import { clamp } from "@/features/workspace/utils/geometry";

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
export const clampScale = (s: number): number => clamp(s, MIN_SCALE, MAX_SCALE);

/** Canvas-relative screen point → world coordinates. */
export function screenToWorld(cam: Camera, sx: number, sy: number): Vec2 {
  return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
}

/** World coordinates → canvas-relative screen point. */
export function worldToScreen(cam: Camera, wx: number, wy: number): Vec2 {
  return { x: wx * cam.scale + cam.x, y: wy * cam.scale + cam.y };
}

/** Zoom by `factor` keeping the screen point (sx, sy) fixed under the cursor. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number): Camera {
  const scale = clampScale(cam.scale * factor);
  const k = scale / cam.scale;
  return { scale, x: sx - (sx - cam.x) * k, y: sy - (sy - cam.y) * k };
}

/** Camera that centers + fits a world rect inside a viewport with padding. */
export function fitRect(rect: Rect, viewport: Size, padding = 80): Camera {
  const vw = Math.max(1, viewport.w);
  const vh = Math.max(1, viewport.h);
  const scale = clampScale(
    Math.min((vw - padding * 2) / Math.max(1, rect.w), (vh - padding * 2) / Math.max(1, rect.h))
  );
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return { scale, x: vw / 2 - cx * scale, y: vh / 2 - cy * scale };
}

/** The world-space rectangle currently visible in a viewport under a camera. */
export function visibleWorldRect(cam: Camera, viewport: Size): Rect {
  const tl = screenToWorld(cam, 0, 0);
  return { x: tl.x, y: tl.y, w: viewport.w / cam.scale, h: viewport.h / cam.scale };
}
