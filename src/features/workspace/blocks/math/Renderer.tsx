"use client";

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius } from "@/config/tokens";
import { BY_TYPE, PRESETS, type MathData } from "@/features/workspace/blocks/math/presets";

function renderKatex(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex || "", {
      displayMode: display,
      throwOnError: false,
      errorColor: color.danger,
      // Untrusted (AI-streamed) LaTeX: keep KaTeX's HTML-injecting commands
      // (\htmlData, \href, \includegraphics) disabled and reject non-standard input.
      trust: false,
      strict: "ignore",
    });
  } catch {
    return "";
  }
}

/**
 * KaTeX math renderer — code-split (lazy) so the ~280KB KaTeX library and its CSS
 * load only when a math block mounts, not in the initial app bundle.
 */
export default function KatexBlock({ block, editing, onChange }: BlockRendererProps<MathData>) {
  const p = BY_TYPE.get(block.type) ?? PRESETS[0];
  const latex = block.data?.latex ?? "";
  const html = useMemo(() => renderKatex(latex, p.display), [latex, p.display]);

  return (
    <div style={{ width: "100%", height: "100%", padding: 10, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        role="math"
        aria-label={`math: ${latex}`}
        style={{
          flex: editing ? "0 0 auto" : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: p.display ? "center" : "flex-start",
          color: color.inkBright,
          minHeight: 32,
        }}
        dangerouslySetInnerHTML={{ __html: html || `<span style="color:${color.muted}">empty</span>` }}
      />
      {editing && (
        <textarea
          value={latex}
          onChange={(e) => onChange?.({ latex: e.target.value })}
          onPointerDown={(e) => e.stopPropagation()}
          spellCheck={false}
          placeholder="LaTeX source…"
          style={{
            width: "100%",
            minHeight: 44,
            resize: "vertical",
            background: color.surface,
            border: `1px solid ${color.border}`,
            borderRadius: radius.sm,
            color: color.inkSoft,
            fontFamily: font.mono,
            fontSize: 13,
            padding: 8,
            outline: "none",
          }}
        />
      )}
    </div>
  );
}
