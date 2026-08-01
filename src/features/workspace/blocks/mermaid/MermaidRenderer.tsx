"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius } from "@/config/tokens";

export interface MermaidData {
  source: string;
}

let initialized = false;

/** Mermaid renderer (lazy-loaded): text diagram source → sanitized SVG. */
export default function MermaidRenderer({ block, editing, onChange }: BlockRendererProps<MermaidData>) {
  const source = block.data?.source ?? "";
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const domId = useRef(`mmd${block.id.replace(/[^a-zA-Z0-9]/g, "")}`);

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict", fontFamily: "var(--font-sans, sans-serif)" });
      initialized = true;
    }
    let cancelled = false;
    mermaid
      .render(domId.current, source || "graph TD; A[empty]")
      .then(({ svg }) => {
        if (!cancelled) { setSvg(svg); setErr(null); }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [source]);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 10, overflow: "auto" }}>
      <div
        role="img"
        aria-label="diagram"
        style={{ flex: editing ? "0 0 auto" : 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40 }}
        // mermaid runs with securityLevel:"strict", which sanitizes its own SVG output
        // nosemgrep: no-unsafe-inner-html -- Mermaid securityLevel:"strict" self-sanitizes its SVG (CLAUDE.md)
        dangerouslySetInnerHTML={{
          __html: err
            ? `<span style="color:${color.danger};font-family:${font.mono};font-size:11px">${err.replace(/</g, "&lt;")}</span>`
            : svg,
        }}
      />
      {editing && (
        <textarea
          value={source}
          onChange={(e) => onChange?.({ source: e.target.value })}
          onPointerDown={(e) => e.stopPropagation()}
          spellCheck={false}
          placeholder="graph TD; A-->B"
          style={{ width: "100%", minHeight: 70, resize: "vertical", background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.sm, color: color.inkSoft, fontFamily: font.mono, fontSize: 13, padding: 8, outline: "none" }}
        />
      )}
    </div>
  );
}
