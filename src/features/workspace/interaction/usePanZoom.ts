"use client";

import { useEffect, type RefObject } from "react";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useSelectionStore } from "@/features/workspace/stores/selection.store";

/**
 * Binds pan + zoom to a container across input modalities:
 *  - wheel / trackpad two-finger → pan
 *  - ctrl|⌘ + wheel / trackpad pinch → zoom (anchored at cursor)
 *  - pointer drag on background → pan (mouse + single-finger touch)
 *  - two-finger touch → pinch zoom
 */
export function usePanZoom(ref: RefObject<HTMLElement | null>): void {
  const panBy = useCameraStore((s) => s.panBy);
  const zoomAt = useCameraStore((s) => s.zoomAt);
  const clearSelection = useSelectionStore((s) => s.clear);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bounds = () => el.getBoundingClientRect();

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = bounds();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      } else {
        panBy(-e.deltaX, -e.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let capturedId = -1;
    const isBackground = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.dataset.wsBg === "1";

    const onPointerDown = (e: PointerEvent) => {
      if (!isBackground(e.target)) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      capturedId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      clearSelection();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      panBy(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const endDrag = () => {
      dragging = false;
      if (capturedId !== -1) {
        try {
          el.releasePointerCapture(capturedId);
        } catch {
          /* pointer already released */
        }
        capturedId = -1;
      }
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);

    let pinchDist = 0;
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const r = bounds();
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mx = (a.clientX + b.clientX) / 2 - r.left;
      const my = (a.clientY + b.clientY) / 2 - r.top;
      if (pinchDist > 0) zoomAt(d / pinchDist, mx, my);
      pinchDist = d;
    };
    const onTouchEnd = () => {
      pinchDist = 0;
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [ref, panBy, zoomAt, clearSelection]);
}
