"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical, Copy, CopyPlus, Trash2 } from "lucide-react";
import type { BlockInstance } from "@/features/workspace/types";
import { color, radius, z as zTokens } from "@/config/tokens";
import { getBlockDefinition } from "@/features/workspace/blocks/registry";
import { BlockRenderer } from "@/features/workspace/blocks/BlockRenderer";
import { BlockErrorBoundary } from "@/features/workspace/blocks/BlockErrorBoundary";
import { blockClipboard } from "@/features/workspace/blocks/shared/clipboard";
import { useUiStore } from "@/features/workspace/stores/ui.store";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";

/**
 * DEV-ONLY interactive wrapper for a block: selection ring, a move grip, a resize
 * handle, and a toolbar (copy / duplicate / delete). A block sits in its own
 * region (region == block), so moving drags the region and resizing keeps the
 * region in sync. Present-mode (student) blocks never mount this — they use the
 * plain pan-through `BlockFrame`.
 */
export function BlockShell({
  block,
  regionId,
  selected,
}: {
  block: BlockInstance;
  regionId: string;
  selected: boolean;
}) {
  const def = getBlockDefinition(block.type);
  const resizable = def?.resizable ?? false;
  const move = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const size = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);

  const scale = () => useCameraStore.getState().camera.scale || 1;
  const region = () => useWorkspaceStore.getState().doc.regions.find((r) => r.id === regionId);

  const startMove = (e: ReactPointerEvent) => {
    e.stopPropagation();
    const r = region();
    if (!r) return;
    useUiStore.getState().select(block.id);
    move.current = { sx: e.clientX, sy: e.clientY, ox: r.position.x, oy: r.position.y };
    (e.target as Element).setPointerCapture(e.pointerId);
    useUiStore.getState().setInteraction("dragging");
  };
  const onMove = (e: ReactPointerEvent) => {
    const k = scale();
    if (move.current) {
      const d = move.current;
      useWorkspaceStore.getState().moveRegion(regionId, { x: d.ox + (e.clientX - d.sx) / k, y: d.oy + (e.clientY - d.sy) / k });
    } else if (size.current) {
      const s = size.current;
      const w = Math.max(80, s.w + (e.clientX - s.sx) / k);
      const h = Math.max(40, s.h + (e.clientY - s.sy) / k);
      useWorkspaceStore.getState().updateBlock(regionId, block.id, { size: { w, h } });
      useWorkspaceStore.getState().setRegionSize(regionId, { w, h });
    }
  };
  const endMove = (e: ReactPointerEvent) => {
    move.current = null;
    size.current = null;
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    useUiStore.getState().setInteraction("idle");
  };
  const startResize = (e: ReactPointerEvent) => {
    e.stopPropagation();
    size.current = { sx: e.clientX, sy: e.clientY, w: block.size.w, h: block.size.h };
    (e.target as Element).setPointerCapture(e.pointerId);
    useUiStore.getState().setInteraction("dragging");
  };

  const dup = () => useWorkspaceStore.getState().duplicateBlock(regionId, block.id);
  const copy = () => blockClipboard.copy(block);
  const del = () => {
    useWorkspaceStore.getState().deleteBlock(regionId, block.id);
    useUiStore.getState().clearSelection();
  };

  return (
    <div
      role="group"
      aria-label={`${def?.label ?? block.type} block`}
      onPointerDown={(e) => { e.stopPropagation(); useUiStore.getState().select(block.id); }}
      style={{
        position: "absolute",
        left: block.position.x,
        top: block.position.y,
        width: block.size.w,
        height: block.size.h,
        zIndex: selected ? zTokens.blockSelected : zTokens.block,
        borderRadius: radius.md,
        outline: selected ? `2px solid ${color.violet2}` : `1px solid transparent`,
        outlineOffset: 3,
        pointerEvents: "auto",
      }}
    >
      <BlockErrorBoundary label={`${block.type}:${block.id}`}>
        <BlockRenderer
          block={block}
          regionId={regionId}
          selected={selected}
          editing={selected}
          onChange={(data) => useWorkspaceStore.getState().updateBlock(regionId, block.id, { data })}
        />
      </BlockErrorBoundary>

      {selected && (
        <>
          {/* move grip */}
          <div
            onPointerDown={startMove}
            onPointerMove={onMove}
            onPointerUp={endMove}
            title="Drag to move"
            style={{ position: "absolute", top: -12, left: -12, width: 24, height: 24, borderRadius: 999, background: color.violet2, color: "#0a0c11", display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", boxShadow: "0 4px 12px rgba(0,0,0,.4)" }}
          >
            <GripVertical size={13} />
          </div>

          {/* toolbar */}
          <div style={{ position: "absolute", top: -14, right: -8, display: "flex", gap: 4, background: "rgba(10,12,17,0.94)", border: `1px solid ${color.border}`, borderRadius: radius.pill, padding: 4, boxShadow: "0 6px 18px rgba(0,0,0,.45)" }} onPointerDown={(e) => e.stopPropagation()}>
            <ToolBtn label="Copy" onClick={copy}><Copy size={13} /></ToolBtn>
            <ToolBtn label="Duplicate" onClick={dup}><CopyPlus size={13} /></ToolBtn>
            <ToolBtn label="Delete" danger onClick={del}><Trash2 size={13} /></ToolBtn>
          </div>

          {/* resize handle */}
          {resizable && (
            <div
              onPointerDown={startResize}
              onPointerMove={onMove}
              onPointerUp={endMove}
              title="Drag to resize"
              style={{ position: "absolute", right: -7, bottom: -7, width: 16, height: 16, borderRadius: 4, background: color.violet2, cursor: "nwse-resize", border: `2px solid ${color.bg}` }}
            />
          )}
        </>
      )}
    </div>
  );
}

function ToolBtn({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ width: 26, height: 26, borderRadius: 999, border: "none", background: "transparent", color: danger ? color.danger : color.muted3, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
    >
      {children}
    </button>
  );
}
