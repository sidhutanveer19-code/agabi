"use client";

import { z } from "zod";
import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Sigma, Calculator, Superscript, Radical } from "lucide-react";
import type { BlockDefinition, BlockRendererProps, BlockIcon } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { color, font, radius } from "@/config/tokens";

export interface MathData {
  latex: string;
}

const schema = z.object({ latex: z.string() }) as z.ZodType<MathData>;

interface MathPreset {
  type: string;
  label: string;
  icon: BlockIcon;
  display: boolean;
  sample: string;
  defaultSize: { w: number; h: number };
}

const PRESETS: MathPreset[] = [
  { type: "formula", label: "Formula", icon: Sigma, display: true, sample: "a^2 + b^2 = c^2", defaultSize: { w: 360, h: 96 } },
  { type: "equation", label: "Equation", icon: Calculator, display: true, sample: "E = mc^2", defaultSize: { w: 360, h: 96 } },
  { type: "inline-equation", label: "Inline Equation", icon: Superscript, display: false, sample: "x^2 + 1", defaultSize: { w: 220, h: 56 } },
  { type: "display-equation", label: "Display Equation", icon: Radical, display: true, sample: "\\int_0^1 x^2\\,dx = \\tfrac{1}{3}", defaultSize: { w: 420, h: 110 } },
];

const BY_TYPE = new Map(PRESETS.map((p) => [p.type, p]));

function renderKatex(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex || "", { displayMode: display, throwOnError: false, errorColor: color.danger });
  } catch {
    return "";
  }
}

function KatexBlock({ block, editing, onChange }: BlockRendererProps<MathData>) {
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

export function registerMathBlocks(): void {
  for (const p of PRESETS) {
    if (hasBlock(p.type)) continue;
    const def: BlockDefinition<MathData> = {
      type: p.type,
      label: p.label,
      category: "math",
      icon: p.icon,
      version: 1,
      component: KatexBlock,
      schema,
      create: () => ({ latex: p.sample }),
      defaultSize: p.defaultSize,
      interactive: true,
      resizable: true,
      keywords: [p.label.toLowerCase(), "math", "latex", "katex"],
    };
    registerBlock(def);
  }
}
