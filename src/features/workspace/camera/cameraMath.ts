import type { Camera, Rect, Size, Vec2 } from "@/features/workspace/types";
import { clamp } from "@/features/workspace/utils/geometry";

/**
 * Pure camera math. No React, no state — just the transforms that map between the
 * infinite world and the screen. Kept isolated so it is trivially testable and
 * reused by interactions, virtualization, navigation, and the minimap.
 *
 * Model: a world point `w` maps to screen `s` as  s = w * scale + {cam.x, cam.y}.
 */

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

/** Constrain a zoom level to the allowed range. */
export function clampScale(scale: number): number {
  return clamp(scale, MIN_SCALE, MAX_SCALE);
}

/** Screen pixel → world coordinate. */
export function screenToWorld(cam: Camera, screen: Vec2): Vec2 {
  return {
    x: (screen.x - cam.x) / cam.scale,
    y: (screen.y - cam.y) / cam.scale,
  };
}

/** World coordinate → screen pixel. */
export function worldToScreen(cam: Camera, world: Vec2): Vec2 {
  return {
    x: world.x * cam.scale + cam.x,
    y: world.y * cam.scale + cam.y,
  };
}

/**
 * Zoom toward a fixed screen point (cursor / pinch center). The world point under
 * the cursor stays put: new translation = s - (s - cam) * k, where k = new/old scale.
 */
export function zoomAt(cam: Camera, screenPoint: Vec2, nextScale: number): Camera {
  const scale = clampScale(nextScale);
  const k = scale / cam.scale;
  return {
    scale,
    x: screenPoint.x - (screenPoint.x - cam.x) * k,
    y: screenPoint.y - (screenPoint.y - cam.y) * k,
  };
}

/** Camera that fits `rect` into `viewport` with padding, centered. */
export function fitRect(rect: Rect, viewport: Size, padding = 80): Camera {
  const availW = Math.max(1, viewport.w - padding * 2);
  const availH = Math.max(1, viewport.h - padding * 2);
  const scale = clampScale(Math.min(availW / rect.w, availH / rect.h));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return {
    scale,
    x: viewport.w / 2 - cx * scale,
    y: viewport.h / 2 - cy * scale,
  };
}

/** The world-space rectangle currently visible through the viewport. */
export function visibleWorldRect(cam: Camera, viewport: Size): Rect {
  const topLeft = screenToWorld(cam, { x: 0, y: 0 });
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: viewport.w / cam.scale,
    h: viewport.h / cam.scale,
  };
}
