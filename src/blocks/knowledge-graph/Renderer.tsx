"use client";

import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { KgData } from "./schema";

export function Renderer({ data }: BlockRendererProps<KgData>) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    cyRef.current?.destroy();
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...data.nodes.map((n) => ({ data: { id: n.id, label: n.label } })),
        ...data.edges.map((e) => ({
          data: { source: e.source, target: e.target, label: e.label ?? "" },
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#12141c",
            "border-color": "#a78bfa",
            "border-width": 2,
            label: "data(label)",
            color: "#f3eee6",
            "font-size": 12,
            "font-family": "sans-serif",
            "text-valign": "center",
            "text-halign": "center",
            shape: "round-rectangle",
            width: "label",
            height: "label",
            padding: "10px",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#3a3f4d",
            "target-arrow-color": "#3a3f4d",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            color: "#8b8579",
            "font-size": 10,
            "font-family": "sans-serif",
            "text-background-color": "#06070c",
            "text-background-opacity": 1,
            "text-background-padding": "2px",
          },
        },
      ],
      layout: { name: "cose", animate: false, padding: 24 },
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data]);

  return <div ref={ref} style={{ width: "100%", height: 340 }} />;
}
