import type { Camera } from "@/features/workspace/types";

/** Cubic ease-out — matches the Phase-1 motion curve feel (calm, decelerating). */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export interface AnimateHandle {
  cancel: () => void;
}

/**
 * Smoothly tween the camera from its current value to `to` over `ms`, calling
 * `onFrame` each rAF tick. Honors reduced-motion by jumping straight to `to`.
 *
 * Returns a handle so callers can cancel an in-flight animation (e.g. the user
 * grabs the canvas mid-fly).
 */
export function animateCamera(
  from: Camera,
  to: Camera,
  onFrame: (cam: Camera) => void,
  opts: { ms?: number; reducedMotion?: boolean } = {}
): AnimateHandle {
  const { ms = 420, reducedMotion = false } = opts;

  if (reducedMotion || ms <= 0) {
    onFrame(to);
    return { cancel: () => {} };
  }

  let raf = 0;
  let start = -1;
  let cancelled = false;

  const step = (ts: number) => {
    if (cancelled) return;
    if (start < 0) start = ts;
    const t = Math.min(1, (ts - start) / ms);
    const e = easeOut(t);
    onFrame({
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      scale: from.scale + (to.scale - from.scale) * e,
    });
    if (t < 1) raf = requestAnimationFrame(step);
  };

  raf = requestAnimationFrame(step);
  return {
    cancel: () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
