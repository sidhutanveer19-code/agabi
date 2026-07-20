import type { Size, Vec2 } from "@/features/workspace/types";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { placeRegion } from "@/features/workspace/regions/placeRegion";

/**
 * Intelligent placement for a new explanation: reading-order, non-overlapping,
 * spaced, infinitely expandable. Reuses the workspace's `placeRegion` (scans for
 * the first free slot) so explanations never stack randomly or collide.
 *
 * (Phase-6 hook: this is where viewport-aware / branch-grouped placement can grow
 * — it already has access to the full region set.)
 */
export function placeExplanation(size: Size): Vec2 {
  const regions = useWorkspaceStore.getState().doc.regions;
  return placeRegion(regions, size);
}
