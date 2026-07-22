import { create } from "zustand";
import type { BlockInstance, Region, Vec2, WorkspaceDoc } from "@/features/workspace/types";
import { emptyDoc } from "@/features/workspace/types/defaults";
import { createId, idSuffix, ensureSeqAbove } from "@/features/workspace/utils/ids";
import { placeRegion, DEFAULT_REGION_SIZE } from "@/features/workspace/regions/placeRegion";

export { emptyDoc };

/**
 * PERSISTENT document state — the workspace itself: regions, blocks, positions,
 * structure. This is the long-term learning environment.
 *
 * Design law: teaching is APPEND-ONLY. There is no delete-of-teaching and no
 * history/undo. "Explain it differently" creates a NEW region; the old one
 * remains forever so the student can compare. `updateBlock` exists only to let a
 * future streaming source fill in a block it already created.
 */

/** Input to addBlock — id + z are assigned by the store. */
export type NewBlock = Omit<BlockInstance, "id" | "z"> & { z?: number };

interface WorkspaceStore {
  doc: WorkspaceDoc;

  /** Replace the whole document (restore from persistence / import). */
  setDoc: (doc: WorkspaceDoc) => void;

  /** Append a new explanation region, placed so it never overlaps existing ones. */
  createRegion: (
    title: string,
    opts?: { accent?: string; blocks?: NewBlock[]; size?: { w: number; h: number } }
  ) => string;

  /** Append a block to a region (streaming-ready). */
  addBlock: (regionId: string, block: NewBlock) => string;

  /** Patch a block's data/position/size in place (for a streaming source to fill in). */
  updateBlock: (regionId: string, blockId: string, patch: Partial<Omit<BlockInstance, "id">>) => void;

  /** Programmatic region move (layout engine / dev drag of a block). */
  moveRegion: (regionId: string, position: Vec2) => void;

  /** Resize a region (dev block resize keeps its wrapping region in sync). */
  setRegionSize: (regionId: string, size: { w: number; h: number }) => void;

  /** Programmatic block move within its region. */
  moveBlock: (regionId: string, blockId: string, position: Vec2) => void;

  /** Remove a block (block-level edit only; regions/explanations stay append-only). */
  deleteBlock: (regionId: string, blockId: string) => void;

  /** Duplicate a block within its region (new id, offset position). Returns new id. */
  duplicateBlock: (regionId: string, blockId: string) => string | null;

  /** Clear back to an empty document (keeps the same id/topic seed on next use). */
  reset: (topic?: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  doc: emptyDoc(),

  setDoc: (doc) => {
    // Restored ids were minted in a previous session; advance the counter past
    // them so freshly created regions/blocks never collide (duplicate React keys).
    let max = 0;
    for (const r of doc.regions) {
      max = Math.max(max, idSuffix(r.id));
      for (const b of r.blocks) max = Math.max(max, idSuffix(b.id));
    }
    ensureSeqAbove(max);
    set({ doc });
  },

  createRegion: (title, opts) => {
    const { doc } = get();
    const id = createId("region");
    const size = opts?.size ?? { ...DEFAULT_REGION_SIZE };
    const position = placeRegion(doc.regions, size);
    const region: Region = {
      id,
      title,
      position,
      size,
      blocks: [],
      createdAt: doc.regions.length + 1,
      accent: opts?.accent,
    };
    let next: Region = region;
    if (opts?.blocks?.length) {
      next = {
        ...region,
        blocks: opts.blocks.map((b, i) => ({ ...b, id: createId("block"), z: b.z ?? i + 1 })),
      };
    }
    set({ doc: { ...doc, regions: [...doc.regions, next] } });
    return id;
  },

  addBlock: (regionId, block) => {
    const { doc } = get();
    const blockId = createId("block");
    set({
      doc: {
        ...doc,
        regions: doc.regions.map((r) =>
          r.id === regionId
            ? { ...r, blocks: [...r.blocks, { ...block, id: blockId, z: block.z ?? r.blocks.length + 1 }] }
            : r
        ),
      },
    });
    return blockId;
  },

  updateBlock: (regionId, blockId, patch) => {
    const { doc } = get();
    set({
      doc: {
        ...doc,
        regions: doc.regions.map((r) =>
          r.id === regionId
            ? { ...r, blocks: r.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }
            : r
        ),
      },
    });
  },

  moveRegion: (regionId, position) => {
    const { doc } = get();
    set({
      doc: { ...doc, regions: doc.regions.map((r) => (r.id === regionId ? { ...r, position } : r)) },
    });
  },

  setRegionSize: (regionId, size) => {
    const { doc } = get();
    set({ doc: { ...doc, regions: doc.regions.map((r) => (r.id === regionId ? { ...r, size } : r)) } });
  },

  moveBlock: (regionId, blockId, position) => {
    const { doc } = get();
    set({
      doc: {
        ...doc,
        regions: doc.regions.map((r) =>
          r.id === regionId
            ? { ...r, blocks: r.blocks.map((b) => (b.id === blockId ? { ...b, position } : b)) }
            : r
        ),
      },
    });
  },

  deleteBlock: (regionId, blockId) => {
    const { doc } = get();
    set({
      doc: {
        ...doc,
        regions: doc.regions.map((r) =>
          r.id === regionId ? { ...r, blocks: r.blocks.filter((b) => b.id !== blockId) } : r
        ),
      },
    });
  },

  duplicateBlock: (regionId, blockId) => {
    const { doc } = get();
    const region = doc.regions.find((r) => r.id === regionId);
    const src = region?.blocks.find((b) => b.id === blockId);
    if (!region || !src) return null;
    const copy = {
      ...src,
      id: createId("block"),
      position: { x: src.position.x + 24, y: src.position.y + 24 },
      z: region.blocks.length + 1,
    };
    set({
      doc: {
        ...doc,
        regions: doc.regions.map((r) => (r.id === regionId ? { ...r, blocks: [...r.blocks, copy] } : r)),
      },
    });
    return copy.id;
  },

  reset: (topic) => set({ doc: emptyDoc(topic) }),
}));
