"use client";

import { useEffect, type RefObject } from "react";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useSelectionStore } from "@/features/workspace/stores/selection.store";

interface Options {
  /** Fit all content into view (bound to the "0" key). */
  onFit: () => void;
}

/**
 * Keyboard camera control (arrows pan, +/- zoom at center, 0 fits all, Esc
 * clears selection). No undo/redo shortcuts by design.
 */
export function useWorkspaceKeyboard(ref: RefObject<HTMLElement | null>, { onFit }: Options): void {
  const panBy = useCameraStore((s) => s.panBy);
  const zoomAt = useCameraStore((s) => s.zoomAt);
  const clearSelection = useSelectionStore((s) => s.clear);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      const step = 80;
      switch (e.key) {
        case "ArrowLeft":
          panBy(step, 0);
          break;
        case "ArrowRight":
          panBy(-step, 0);
          break;
        case "ArrowUp":
          panBy(0, step);
          break;
        case "ArrowDown":
          panBy(0, -step);
          break;
        case "=":
        case "+":
          zoomAt(1.15, cx, cy);
          break;
        case "-":
          zoomAt(0.87, cx, cy);
          break;
        case "0":
          onFit();
          break;
        case "Escape":
          clearSelection();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [ref, panBy, zoomAt, onFit, clearSelection]);
}
