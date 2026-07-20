"use client";

import { useEffect, type RefObject } from "react";
import type { Region } from "@/features/workspace/types";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useUiStore } from "@/features/workspace/stores/ui.store";
import { clampScale } from "@/features/workspace/camera/cameraMath";

interface KeyboardOpts {
  /** Fit all regions into view (bound to `0`). */
  onFit: () => void;
  /** Fly to a region (bound to Tab cycling). */
  onGoToRegion: (region: Region) => void;
  /** Current regions, for Tab cycling. */
  getRegions: () => Region[];
}

const PAN_STEP = 80;

/**
 * Keyboard navigation for the canvas. Arrows pan, +/- zoom (centered), `0` fits,
 * `Tab`/`Shift+Tab` cycles explanations, `Escape` clears selection.
 *
 * There are intentionally NO undo/redo shortcuts — teaching is append-only.
 */
export function useWorkspaceKeyboard(ref: RefObject<HTMLElement | null>, opts: KeyboardOpts) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let cycle = -1;

    const centerZoom = (factor: number) => {
      const r = el.getBoundingClientRect();
      const c = useCameraStore.getState().camera;
      useCameraStore.getState().zoomAt({ x: r.width / 2, y: r.height / 2 }, clampScale(c.scale * factor));
    };

    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          useCameraStore.getState().panBy(PAN_STEP, 0);
          break;
        case "ArrowRight":
          e.preventDefault();
          useCameraStore.getState().panBy(-PAN_STEP, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          useCameraStore.getState().panBy(0, PAN_STEP);
          break;
        case "ArrowDown":
          e.preventDefault();
          useCameraStore.getState().panBy(0, -PAN_STEP);
          break;
        case "+":
        case "=":
          e.preventDefault();
          centerZoom(1.2);
          break;
        case "-":
        case "_":
          e.preventDefault();
          centerZoom(1 / 1.2);
          break;
        case "0":
          e.preventDefault();
          opts.onFit();
          break;
        case "Tab": {
          const regions = opts.getRegions();
          if (regions.length === 0) return;
          e.preventDefault();
          cycle = e.shiftKey
            ? (cycle - 1 + regions.length) % regions.length
            : (cycle + 1) % regions.length;
          const region = regions[cycle];
          useUiStore.getState().setFocus(region.id);
          opts.onGoToRegion(region);
          break;
        }
        case "Escape":
          useUiStore.getState().clearSelection();
          break;
        default:
          break;
      }
    };

    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [ref, opts]);
}
