import { create } from "zustand";
import type { BlockInstance, Region, Size, Vec2, WorkspaceDoc } from "@/features/workspace/types";
import { SCHEMA_VERSION } from "@/features/workspace/types";
import { createId, nextSeq } from "@/features/workspace/utils/ids";
import { placeNewRegion } from "@/features/workspace/regions/placeNewRegion";

export function emptyDoc(id = "default"): WorkspaceDoc {
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    regions: [],
    createdAt: nextSeq(),
    updatedAt: nextSeq(),
  };
}

type NewBlock = Omit<BlockInstance, "id" | "z"> & { id?: string; z?: number };

interface WorkspaceStore {
  doc: WorkspaceDoc;
  setDoc: (doc: WorkspaceDoc) => void;
  /** New explanation → a fresh, non-overlapping region. Never overwrites. */
  createRegion: (title: string, opts?: { size?: Size; accent?: string }) => string;
  /** Append a block to a region (streaming-ready; never replaces). */
  addBlock: (regionId: string, block: NewBlock) => string;
  /** Programmatic positioning engine (not student drag). */
  moveRegion: (regionId: string, position: Vec2) => void;
  reset: () => void;
}

/**
 * The workspace document: append-only regions of positioned blocks. No delete of
 * teaching content, no history/undo — intentional learning actions only.
 */
export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  doc: emptyDoc(),
  setDoc: (doc) => set({ doc }),

  createRegion: (title, opts) => {
    const id = createId("region");
    const size = opts?.size ?? { w: 640, h: 420 };
    set((s) => {
      const position = placeNewRegion(s.doc.regions, size);
      const region: Region = {
        id,
        title,
        position,
        size,
        blocks: [],
        createdAt: nextSeq(),
        accent: opts?.accent,
      };
      return { doc: { ...s.doc, regions: [...s.doc.regions, region], updatedAt: nextSeq() } };
    });
    return id;
  },

  addBlock: (regionId, block) => {
    const id = block.id ?? createId("block");
    set((s) => ({
      doc: {
        ...s.doc,
        regions: s.doc.regions.map((r) =>
          r.id === regionId
            ? { ...r, blocks: [...r.blocks, { ...block, id, z: block.z ?? r.blocks.length }] }
            : r
        ),
        updatedAt: nextSeq(),
      },
    }));
    return id;
  },

  moveRegion: (regionId, position) =>
    set((s) => ({
      doc: {
        ...s.doc,
        regions: s.doc.regions.map((r) => (r.id === regionId ? { ...r, position } : r)),
        updatedAt: nextSeq(),
      },
    })),

  reset: () => set({ doc: emptyDoc() }),
}));
