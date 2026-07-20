"use client";

import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color } from "@/config/tokens";

export interface FlowData {
  nodes: Node[];
  edges: Edge[];
}

/** React Flow renderer (lazy-loaded). Editable nodes/edges in dev, static in present. */
export default function FlowRenderer({ block, editing, onChange }: BlockRendererProps<FlowData>) {
  const data = block.data ?? { nodes: [], edges: [] };
  const set = (p: Partial<FlowData>) => onChange?.({ ...data, ...p });

  return (
    <div style={{ width: "100%", height: "100%", borderRadius: 14, overflow: "hidden", border: `1px solid ${color.border}`, background: color.paper }}>
      <ReactFlow
        nodes={data.nodes}
        edges={data.edges}
        onNodesChange={editing ? (c: NodeChange[]) => set({ nodes: applyNodeChanges(c, data.nodes) }) : undefined}
        onEdgesChange={editing ? (c: EdgeChange[]) => set({ edges: applyEdgeChanges(c, data.edges) }) : undefined}
        onConnect={editing ? (c: Connection) => set({ edges: addEdge(c, data.edges) }) : undefined}
        nodesDraggable={!!editing}
        nodesConnectable={!!editing}
        elementsSelectable={!!editing}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background color={color.border} gap={20} />
        {editing ? <Controls showInteractive={false} /> : null}
      </ReactFlow>
    </div>
  );
}
