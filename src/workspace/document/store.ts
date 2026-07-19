"use client";

import { create } from "zustand";
import type { BlockInstance, WorkspaceDoc } from "@/workspace/blocks";

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

const INITIAL_CAMERA: Camera = { x: 0, y: 0, scale: 1 };

interface WorkspaceState {
  doc: WorkspaceDoc | null;
  camera: Camera;
  selectedId: string | null;

  setDoc: (doc: WorkspaceDoc) => void;
  appendBlocks: (blocks: BlockInstance[]) => void;
  clear: () => void;
  select: (id: string | null) => void;

  setCamera: (c: Partial<Camera>) => void;
  panBy: (dx: number, dy: number) => void;
  /** Zoom by `factor` keeping screen point (sx, sy) — relative to the canvas — fixed. */
  zoomAt: (factor: number, sx: number, sy: number) => void;
  resetCamera: () => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  doc: null,
  camera: INITIAL_CAMERA,
  selectedId: null,

  setDoc: (doc) => set({ doc, selectedId: null, camera: INITIAL_CAMERA }),
  appendBlocks: (blocks) =>
    set((s) =>
      s.doc ? { doc: { ...s.doc, blocks: [...s.doc.blocks, ...blocks] } } : {}
    ),
  clear: () => set({ doc: null, selectedId: null, camera: INITIAL_CAMERA }),
  select: (id) => set({ selectedId: id }),

  setCamera: (c) => set((s) => ({ camera: { ...s.camera, ...c } })),
  panBy: (dx, dy) =>
    set((s) => ({ camera: { ...s.camera, x: s.camera.x + dx, y: s.camera.y + dy } })),
  zoomAt: (factor, sx, sy) =>
    set((s) => {
      const scale = clampScale(s.camera.scale * factor);
      const k = scale / s.camera.scale;
      // keep the world point under (sx, sy) fixed: x' = sx - (sx - x) * k
      return {
        camera: {
          scale,
          x: sx - (sx - s.camera.x) * k,
          y: sy - (sy - s.camera.y) * k,
        },
      };
    }),
  resetCamera: () => set({ camera: INITIAL_CAMERA }),
}));
