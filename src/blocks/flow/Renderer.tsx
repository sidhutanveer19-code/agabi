"use client";

import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { color, font, radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { FlowData } from "./schema";

export function Renderer({ data }: BlockRendererProps<FlowData>) {
  const nodes: Node[] = data.nodes.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label },
    style: {
      background: "#12141c",
      border: `1px solid ${color.borderStrong}`,
      borderRadius: radius.md,
      color: color.ink,
      fontFamily: font.sans,
      fontSize: 13,
      padding: "8px 12px",
    },
  }));
  const edges: Edge[] = data.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: true,
    style: { stroke: color.violet2 },
    labelStyle: { fill: color.muted3, fontFamily: font.sans, fontSize: 11 },
  }));

  return (
    <div style={{ width: "100%", height: 300, borderRadius: radius.lg, overflow: "hidden" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background color={color.border} gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
