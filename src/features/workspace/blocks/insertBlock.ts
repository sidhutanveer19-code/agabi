import type { Size } from "@/features/workspace/types";
import type { BlockDefinition } from "@/features/workspace/blocks/types";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useUiStore } from "@/features/workspace/stores/ui.store";
import { screenToWorld } from "@/features/workspace/camera/cameraMath";
import { blockClipboard } from "@/features/workspace/blocks/shared/clipboard";

/**
 * Insert a fresh block of `def`'s type at the viewport center as its own region
 * (region == block, so it moves/resizes as one unit), then select it. This is
 * the dev authoring entry point — and the exact API a future AI drives.
 */
export function insertBlock(def: BlockDefinition, viewport: Size): void {
  const size = def.defaultSize ?? { w: 420, h: 140 };
  const cam = useCameraStore.getState().camera;
  const c = screenToWorld(cam, { x: viewport.w / 2, y: viewport.h / 2 });
  const pos = { x: Math.round(c.x - size.w / 2), y: Math.round(c.y - size.h / 2) };
  const store = useWorkspaceStore.getState();
  const data = def.create ? def.create() : {};
  const rid = store.createRegion(def.label ?? def.type, {
    size,
    blocks: [{ type: def.type, position: { x: 0, y: 0 }, size, data }],
  });
  store.moveRegion(rid, pos);
  const region = useWorkspaceStore.getState().doc.regions.find((r) => r.id === rid);
  const blockId = region?.blocks[0]?.id;
  if (blockId) useUiStore.getState().select(blockId);
}

/** Paste the clipboard block as a new offset region near the viewport center. */
export function pasteBlock(viewport: Size): void {
  const src = blockClipboard.get();
  if (!src) return;
  const size = src.size;
  const cam = useCameraStore.getState().camera;
  const c = screenToWorld(cam, { x: viewport.w / 2, y: viewport.h / 2 });
  const pos = { x: Math.round(c.x - size.w / 2 + 20), y: Math.round(c.y - size.h / 2 + 20) };
  const store = useWorkspaceStore.getState();
  const rid = store.createRegion(src.type, {
    size,
    blocks: [{ type: src.type, position: { x: 0, y: 0 }, size, data: src.data }],
  });
  store.moveRegion(rid, pos);
  const region = useWorkspaceStore.getState().doc.regions.find((r) => r.id === rid);
  const blockId = region?.blocks[0]?.id;
  if (blockId) useUiStore.getState().select(blockId);
}
