"use client";

import { z } from "zod";
import { useRef, useState } from "react";
import { Workflow, Plus, Link2 } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { createId } from "@/features/workspace/utils/ids";
import { color, font, radius } from "@/config/tokens";

export interface DiagramNode {
  id: string;
  x: number;
  y: number;
  label: string;
}
export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
}
export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const schema = z.object({
  nodes: z.array(z.object({ id: z.string(), x: z.number(), y: z.number(), label: z.string() })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string() })),
}) as z.ZodType<DiagramData>;

const NW = 120;
const NH = 44;

function DiagramBlock({ block, editing, onChange }: BlockRendererProps<DiagramData>) {
  const data = block.data ?? { nodes: [], edges: [] };
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  const patch = (p: Partial<DiagramData>) => onChange?.({ ...data, ...p });
  const nodeById = (id: string) => data.nodes.find((n) => n.id === id);

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    if (!editing) return;
    e.stopPropagation();
    if (connectFrom) {
      if (connectFrom !== id) patch({ edges: [...data.edges, { id: createId("edge"), from: connectFrom, to: id }] });
      setConnectFrom(null);
      return;
    }
    const p = toSvg(e.clientX, e.clientY);
    const node = nodeById(id)!;
    drag.current = { id, dx: p.x - node.x, dy: p.y - node.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = toSvg(e.clientX, e.clientY);
    const { id, dx, dy } = drag.current;
    patch({ nodes: data.nodes.map((n) => (n.id === id ? { ...n, x: p.x - dx, y: p.y - dy } : n)) });
  };
  const onUp = () => { drag.current = null; };

  const editLabel = (id: string) => {
    const node = nodeById(id);
    if (!node) return;
    const label = window.prompt("Node label", node.label);
    if (label !== null) patch({ nodes: data.nodes.map((n) => (n.id === id ? { ...n, label } : n)) });
  };
  const addNode = () => patch({ nodes: [...data.nodes, { id: createId("node"), x: 40 + data.nodes.length * 24, y: 40 + data.nodes.length * 20, label: "Node" }] });

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: 6, padding: 4 }}>
      <svg
        ref={svgRef}
        role="img"
        aria-label="diagram"
        style={{ flex: 1, width: "100%", background: color.paper, borderRadius: radius.md, border: `1px solid ${color.border}`, touchAction: "none" }}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <defs>
          <marker id="agabi-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="none" stroke={color.muted3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        {data.edges.map((e) => {
          const a = nodeById(e.from);
          const b = nodeById(e.to);
          if (!a || !b) return null;
          return <line key={e.id} x1={a.x + NW / 2} y1={a.y + NH / 2} x2={b.x + NW / 2} y2={b.y + NH / 2} stroke={color.muted3} strokeWidth={1.5} markerEnd="url(#agabi-arrow)" />;
        })}

        {data.nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: editing ? "move" : "default" }} onPointerDown={onNodeDown(n.id)} onDoubleClick={() => editing && editLabel(n.id)}>
            <rect width={NW} height={NH} rx={10} fill={color.surface} stroke={connectFrom === n.id ? color.violet2 : color.borderStrong} strokeWidth={connectFrom === n.id ? 2 : 1} />
            <text x={NW / 2} y={NH / 2 + 4} textAnchor="middle" fill={color.inkSoft} fontFamily={font.sans} fontSize={13}>
              {n.label}
            </text>
          </g>
        ))}
      </svg>

      {editing && (
        <div style={{ display: "flex", gap: 6 }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={addNode} style={ctrlBtn}><Plus size={12} /> Node</button>
          <button type="button" onClick={() => setConnectFrom(connectFrom ? null : data.nodes[0]?.id ?? null)} style={{ ...ctrlBtn, borderColor: connectFrom ? color.violet2 : color.border, color: connectFrom ? color.violet3 : color.muted3 }}>
            <Link2 size={12} /> {connectFrom ? "click target…" : "Connect"}
          </button>
          <span style={{ alignSelf: "center", color: color.muted2, fontFamily: font.mono, fontSize: 10 }}>double-click a node to rename</span>
        </div>
      )}
    </div>
  );
}

const ctrlBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 10px",
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  background: color.surface,
  color: color.muted3,
  fontFamily: font.sans,
  fontSize: 12,
  cursor: "pointer",
};

export function registerDiagramBlock(): void {
  if (hasBlock("basic-diagram")) return;
  const def: BlockDefinition<DiagramData> = {
    type: "basic-diagram",
    label: "Basic Diagram",
    category: "diagram",
    icon: Workflow,
    version: 1,
    component: DiagramBlock,
    schema,
    create: () => ({
      nodes: [
        { id: createId("node"), x: 30, y: 40, label: "Start" },
        { id: createId("node"), x: 220, y: 120, label: "Next" },
      ],
      edges: [],
    }),
    defaultSize: { w: 420, h: 280 },
    interactive: true,
    resizable: true,
    keywords: ["diagram", "flow", "nodes", "graph"],
  };
  registerBlock(def);
}
