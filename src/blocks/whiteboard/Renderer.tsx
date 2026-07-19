"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { WhiteboardData } from "./schema";

export function Renderer({ data }: BlockRendererProps<WhiteboardData>) {
  return (
    <div style={{ height: 360, borderRadius: radius.lg, overflow: "hidden" }}>
      <Excalidraw
        theme="dark"
        viewModeEnabled={data.viewOnly}
        initialData={{
          // elements come from our own composer; Excalidraw's element type is internal
          elements: data.elements as never,
          appState: { viewBackgroundColor: "#0a0c11" },
          scrollToContent: true,
        }}
      />
    </div>
  );
}
