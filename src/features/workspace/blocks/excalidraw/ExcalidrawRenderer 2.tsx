"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";

export interface ExcalidrawData {
  elements: unknown[];
}

/** Excalidraw renderer (lazy-loaded). View-only in present, editable in dev. */
export default function ExcalidrawRenderer({ block, editing, onChange }: BlockRendererProps<ExcalidrawData>) {
  const data = block.data ?? { elements: [] };
  return (
    <div style={{ width: "100%", height: "100%", borderRadius: 14, overflow: "hidden" }}>
      <Excalidraw
        theme="dark"
        viewModeEnabled={!editing}
        initialData={{ elements: data.elements as never, scrollToContent: true }}
        onChange={editing ? (elements) => onChange?.({ elements: elements as unknown[] }) : undefined}
      />
    </div>
  );
}
