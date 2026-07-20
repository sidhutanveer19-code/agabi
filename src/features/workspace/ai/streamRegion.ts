import type { PlannedBlock } from "@/features/workspace/ai/types";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { placeExplanation } from "@/features/workspace/ai/placement";

/** Lesson column layout inside a region. */
export const PAD = 26;
export const CONTENT_W = 660;
export const GAP = 16;

/**
 * Open a new explanation region, placed so it never overlaps existing ones.
 * Blocks stream into it below, growing the region as they arrive (append-only).
 */
export function openRegion(title: string): { id: string } {
  const store = useWorkspaceStore.getState();
  const size = { w: CONTENT_W + PAD * 2, h: PAD * 2 + 40 };
  const id = store.createRegion(title, { size });
  store.moveRegion(id, placeExplanation({ w: CONTENT_W + PAD * 2, h: 460 }));
  return { id };
}

/**
 * Append one streamed block to a region in vertical flow, growing the region to
 * fit. Returns the new block id + the next layout cursor.
 */
export function addStreamedBlock(
  regionId: string,
  block: PlannedBlock,
  cursor: number
): { blockId: string; nextCursor: number } {
  const store = useWorkspaceStore.getState();
  const blockId = store.addBlock(regionId, {
    type: block.type,
    position: { x: PAD, y: cursor },
    size: { w: CONTENT_W, h: block.height },
    data: block.data,
  });
  const nextCursor = cursor + block.height + GAP;
  store.setRegionSize(regionId, { w: CONTENT_W + PAD * 2, h: nextCursor + PAD });
  return { blockId, nextCursor };
}
