"use client";

import { useEffect, type RefObject } from "react";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useUiStore } from "@/features/workspace/stores/ui.store";
import { clampScale } from "@/features/workspace/camera/cameraMath";

/**
 * Pointer / wheel / trackpad / touch pan + zoom, bound to the canvas container.
 *
 * - wheel               → pan
 * - ctrl|⌘ + wheel      → zoom anchored at the cursor (native trackpad pinch)
 * - pointer drag on bg  → pan (only when the gesture starts on the background)
 * - two-finger touch    → pinch-zoom anchored at the midpoint
 *
 * Listeners are attached with `{ passive: false }` so the page never scrolls
 * behind the infinite canvas.
 */
export function usePanZoom(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ui = useUiStore.getState();

    const localPoint = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    // ---- wheel: pan, or zoom with modifier ----
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const p = localPoint(e.clientX, e.clientY);
        const factor = Math.exp(-e.deltaY * 0.0015);
        const c = useCameraStore.getState().camera;
        useCameraStore.getState().zoomAt(p, clampScale(c.scale * factor));
      } else {
        useCameraStore.getState().panBy(-e.deltaX, -e.deltaY);
      }
    };

    // ---- pointer drag on background: pan ----
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    const isBackground = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.dataset.wsBg === "1";

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if (!isBackground(e.target)) return;
      panning = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      ui.setInteraction("panning");
      ui.clearSelection();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      useCameraStore.getState().panBy(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const endPan = (e: PointerEvent) => {
      if (!panning) return;
      panning = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      useUiStore.getState().setInteraction("idle");
    };

    // ---- two-finger touch pinch ----
    let pinchDist = 0;
    const touchDist = (t: TouchList) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.hypot(dx, dy);
    };
    const touchMid = (t: TouchList) => localPoint((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinchDist = touchDist(e.touches);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const dist = touchDist(e.touches);
      if (pinchDist > 0) {
        const c = useCameraStore.getState().camera;
        useCameraStore.getState().zoomAt(touchMid(e.touches), clampScale(c.scale * (dist / pinchDist)));
      }
      pinchDist = dist;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchDist = 0;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endPan);
    el.addEventListener("pointercancel", endPan);
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPan);
      el.removeEventListener("pointercancel", endPan);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [ref]);
}
