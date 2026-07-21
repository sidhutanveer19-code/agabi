import { z } from "zod";
import { Sigma, Calculator, Superscript, Radical } from "lucide-react";
import type { BlockIcon } from "@/features/workspace/blocks/types";

export interface MathData {
  latex: string;
}

export const mathSchema = z.object({ latex: z.string() }) as z.ZodType<MathData>;

export interface MathPreset {
  type: string;
  label: string;
  icon: BlockIcon;
  display: boolean;
  sample: string;
  defaultSize: { w: number; h: number };
}

/**
 * Math presets — kept in a katex-free module so block registration (and the
 * insert palette) stay lightweight; the heavy KaTeX renderer is code-split into
 * ./Renderer and loaded only when a math block actually mounts.
 */
export const PRESETS: MathPreset[] = [
  { type: "formula", label: "Formula", icon: Sigma, display: true, sample: "a^2 + b^2 = c^2", defaultSize: { w: 360, h: 96 } },
  { type: "equation", label: "Equation", icon: Calculator, display: true, sample: "E = mc^2", defaultSize: { w: 360, h: 96 } },
  { type: "inline-equation", label: "Inline Equation", icon: Superscript, display: false, sample: "x^2 + 1", defaultSize: { w: 220, h: 56 } },
  { type: "display-equation", label: "Display Equation", icon: Radical, display: true, sample: "\\int_0^1 x^2\\,dx = \\tfrac{1}{3}", defaultSize: { w: 420, h: 110 } },
];

export const BY_TYPE = new Map(PRESETS.map((p) => [p.type, p]));
