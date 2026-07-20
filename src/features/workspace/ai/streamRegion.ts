import type { StreamedBlock } from "@contract";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { placeExplanation } from "@/features/workspace/ai/placement";

/** Lesson column layout inside a region. */
export const PAD = 26;
export const CONTENT_W = 660;
export const GAP = 16;

/**
 * Rendered height per block type — a FRONTEND layout concern (the wire contract
 * carries no geometry). Falls back to a sensible default for unknown types.
 */
const HEIGHT: Record<string, number> = {
  heading: 60, subheading: 46, paragraph: 104, richtext: 130, quote: 96, notes: 120, caption: 40,
  callout: 122, tip: 122, warning: 122, summary: 118, definition: 122, example: 122,
  bullet: 150, numbered: 150, checklist: 150,
  formula: 92, equation: 92, "inline-equation": 56, "display-equation": 110, mathfield: 84,
  chart: 300, graph: 300, geometry: 300, table: 240, image: 340, divider: 24,
  "basic-diagram": 280, flow: 320, mermaid: 300, threed: 320, physics: 300, molecule: 320,
  monaco: 300, map: 320, timeline: 260, mindmap: 300, figure: 340, video: 300, audio: 120,
  gallery: 300, document: 400, embed: 340,
};
function blockHeight(type: string): number {
  return HEIGHT[type] ?? 140;
}

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
  block: StreamedBlock,
  cursor: number
): { blockId: string; nextCursor: number } {
  const store = useWorkspaceStore.getState();
  const h = blockHeight(block.type);
  const blockId = store.addBlock(regionId, {
    type: block.type,
    position: { x: PAD, y: cursor },
    size: { w: CONTENT_W, h },
    data: block.data,
  });
  const nextCursor = cursor + h + GAP;
  store.setRegionSize(regionId, { w: CONTENT_W + PAD * 2, h: nextCursor + PAD });
  return { blockId, nextCursor };
}
