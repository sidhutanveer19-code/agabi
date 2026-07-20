import { create } from "zustand";
import type { Camera, Rect, Size } from "@/features/workspace/types";
import { fitRect, zoomAt as zoomAtMath } from "@/features/workspace/camera/cameraMath";

const INITIAL: Camera = { x: 0, y: 0, scale: 1 };

interface CameraStore {
  camera: Camera;
  setCamera: (c: Camera) => void;
  panBy: (dx: number, dy: number) => void;
  zoomAt: (factor: number, sx: number, sy: number) => void;
  fit: (rect: Rect, viewport: Size) => void;
  reset: () => void;
}

/**
 * Camera state — high-frequency (updates every pan/zoom frame). Kept separate so
 * only the transform layer + virtualization subscribe; block content never
 * re-renders on pan.
 */
export const useCameraStore = create<CameraStore>((set) => ({
  camera: INITIAL,
  setCamera: (camera) => set({ camera }),
  panBy: (dx, dy) => set((s) => ({ camera: { ...s.camera, x: s.camera.x + dx, y: s.camera.y + dy } })),
  zoomAt: (factor, sx, sy) => set((s) => ({ camera: zoomAtMath(s.camera, factor, sx, sy) })),
  fit: (rect, viewport) => set({ camera: fitRect(rect, viewport) }),
  reset: () => set({ camera: INITIAL }),
}));
