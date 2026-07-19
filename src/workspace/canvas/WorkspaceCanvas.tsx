"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as RKeyboardEvent,
  type PointerEvent as RPointerEvent,
} from "react";
import { color } from "@/design-system/tokens";
import { BlockFrame, BlockRenderer } from "@/workspace/blocks";
import { useWorkspace } from "@/workspace/document/store";

/**
 * Agabi's own infinite canvas. Owns pan/zoom/camera/keyboard. Blocks are placed
 * in world coordinates inside a single transformed layer; libraries live only
 * inside the blocks. Wheel = pan, ctrl/⌘+wheel = zoom, drag background = pan,
 * arrows/=/-/0 = keyboard camera.
 */
export function WorkspaceCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const doc = useWorkspace((s) => s.doc);
  const camera = useWorkspace((s) => s.camera);
  const selectedId = useWorkspace((s) => s.selectedId);
  const select = useWorkspace((s) => s.select);
  const panBy = useWorkspace((s) => s.panBy);
  const zoomAt = useWorkspace((s) => s.zoomAt);
  const resetCamera = useWorkspace((s) => s.resetCamera);

  // native, non-passive wheel so we can preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        panBy(-e.deltaX, -e.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [panBy, zoomAt]);

  // drag-to-pan from the background only (not from inside a block)
  const drag = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const onPointerDown = useCallback(
    (e: RPointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.dataset.canvasBg) return;
      drag.current = { active: true, x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      select(null);
    },
    [select]
  );
  const onPointerMove = useCallback(
    (e: RPointerEvent) => {
      if (!drag.current.active) return;
      panBy(e.clientX - drag.current.x, e.clientY - drag.current.y);
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
    },
    [panBy]
  );
  const endDrag = useCallback(() => {
    drag.current.active = false;
  }, []);

  const onKeyDown = useCallback(
    (e: RKeyboardEvent) => {
      const el = containerRef.current;
      const cx = (el?.clientWidth ?? 0) / 2;
      const cy = (el?.clientHeight ?? 0) / 2;
      const step = 60;
      switch (e.key) {
        case "ArrowLeft": panBy(step, 0); break;
        case "ArrowRight": panBy(-step, 0); break;
        case "ArrowUp": panBy(0, step); break;
        case "ArrowDown": panBy(0, -step); break;
        case "=":
        case "+": zoomAt(1.1, cx, cy); break;
        case "-": zoomAt(0.9, cx, cy); break;
        case "0": resetCamera(); break;
        default: return;
      }
      e.preventDefault();
    },
    [panBy, zoomAt, resetCamera]
  );

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Learning canvas. Drag to pan, control plus scroll to zoom, arrow keys to move."
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="ds-focus"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        cursor: "grab",
        touchAction: "none",
        backgroundColor: color.bg,
        backgroundImage: "radial-gradient(rgba(255,255,255,.028) 1px,transparent 1px)",
        backgroundSize: `${28 * camera.scale}px ${28 * camera.scale}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
    >
      {/* background hit-target for panning */}
      <div data-canvas-bg="1" style={{ position: "absolute", inset: 0 }} />

      {/* transformed world layer */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
        }}
      >
        {doc?.blocks.map((block) => (
          <div key={block.id} style={{ pointerEvents: "auto" }}>
            <BlockFrame
              x={block.layout.x}
              y={block.layout.y}
              w={block.layout.w}
              h={block.layout.h}
              selected={selectedId === block.id}
              label={block.type}
              onSelect={() => select(block.id)}
            >
              <BlockRenderer block={block} />
            </BlockFrame>
          </div>
        ))}
      </div>
    </div>
  );
}
