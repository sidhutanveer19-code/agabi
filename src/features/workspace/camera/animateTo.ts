import type { Camera } from "@/features/workspace/types";

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export interface CameraAnimation {
  cancel: () => void;
}

/**
 * Tween the camera to `target` via rAF. Respects reduced-motion (jumps instead
 * of animating). Returns a handle to cancel an in-flight animation.
 */
export function animateCamera(
  get: () => Camera,
  set: (c: Camera) => void,
  target: Camera,
  opts: { durationMs?: number; reduced?: boolean } = {}
): CameraAnimation {
  const { durationMs = 420, reduced = false } = opts;
  if (reduced || durationMs <= 0) {
    set(target);
    return { cancel: () => {} };
  }
  const start = get();
  const t0 = performance.now();
  let raf = 0;
  let cancelled = false;

  const step = (now: number) => {
    if (cancelled) return;
    const t = Math.min(1, (now - t0) / durationMs);
    const e = easeOutCubic(t);
    set({
      x: start.x + (target.x - start.x) * e,
      y: start.y + (target.y - start.y) * e,
      scale: start.scale + (target.scale - start.scale) * e,
    });
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    },
  };
}
