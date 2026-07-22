import { create } from "zustand";
import type { Camera, Rect, Size, Vec2 } from "@/features/workspace/types";
import { DEFAULT_CAMERA } from "@/features/workspace/types/defaults";
import { fitRect, zoomAt, clampScale } from "@/features/workspace/camera/cameraMath";

/**
 * PERSISTENT camera state — {x, y, scale}. Isolated in its own store because it
 * changes at pointer/animation frequency: only the transform layer and the
 * virtualizer subscribe, so a pan never re-renders block content.
 */
export interface CameraStore {
  camera: Camera;
  setCamera: (cam: Camera) => void;
  panBy: (dx: number, dy: number) => void;
  zoomAt: (screenPoint: Vec2, nextScale: number) => void;
  zoomByFactor: (screenPoint: Vec2, factor: number) => void;
  fit: (rect: Rect, viewport: Size, padding?: number) => void;
  reset: () => void;
}

/** Single-sourced from types/defaults so server code can share it without dragging in the store. */
export const INITIAL_CAMERA: Camera = DEFAULT_CAMERA;

export const useCameraStore = create<CameraStore>((set, get) => ({
  camera: INITIAL_CAMERA,
  setCamera: (camera) => set({ camera }),
  panBy: (dx, dy) => {
    const c = get().camera;
    set({ camera: { ...c, x: c.x + dx, y: c.y + dy } });
  },
  zoomAt: (screenPoint, nextScale) => set({ camera: zoomAt(get().camera, screenPoint, nextScale) }),
  zoomByFactor: (screenPoint, factor) => {
    const c = get().camera;
    set({ camera: zoomAt(c, screenPoint, clampScale(c.scale * factor)) });
  },
  fit: (rect, viewport, padding) => set({ camera: fitRect(rect, viewport, padding) }),
  reset: () => set({ camera: INITIAL_CAMERA }),
}));
