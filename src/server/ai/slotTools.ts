import { tool } from "ai";
import { z } from "zod";
import { BLOCK_HINTS } from "@/server/ai/blockTypes";
import { isText } from "@/server/ai/outline";
import type { OnBlock } from "@/server/ai/blockTools";

/**
 * Per-slot tool. The model is handed EXACTLY ONE tool, for EXACTLY ONE block
 * type. There is no text tool in scope when the slot is visual, so it cannot
 * emit prose. This is the enforcement, not a request.
 */

const TEXT_SHAPE = z.object({ text: z.string().min(1) });
const LOOSE = z.record(z.string(), z.unknown());

/** Tight schemas for the types a model most often gets wrong. */
const SCHEMAS: Record<string, z.ZodTypeAny> = {
  mindmap: z.object({ markdown: z.string().min(3) }),
  timeline: z.object({ items: z.array(z.object({
    id: z.number(), content: z.string(), start: z.string(),
  })).min(2) }),
  table: z.object({ headers: z.array(z.string()).min(2),
    rows: z.array(z.array(z.string())).min(1) }),
  formula: z.object({ latex: z.string().min(1) }),
  graph: z.object({ fn: z.string().min(1) }),
  chart: z.object({
    kind: z.enum(["bar", "line", "area", "pie", "scatter"]),
    data: z.array(z.object({ label: z.string(), value: z.number() })).min(2),
  }),
  geometry: z.object({
    points: z.array(z.object({ id: z.string(), x: z.number(), y: z.number(), name: z.string() })).min(2),
    segments: z.array(z.array(z.string()).length(2)).min(1),
  }),
};

const hintFor = (type: string) =>
  BLOCK_HINTS[type] ??
  Object.entries(BLOCK_HINTS).find(([k]) => k.includes(type))?.[1] ??
  "";

const toolName = (type: string) => `emit_${type.replace(/-/g, "_")}`;

export function buildSlotTool(slotType: string, onBlock: OnBlock) {
  const text = isText(slotType);
  const shape = SCHEMAS[slotType] ?? (text ? TEXT_SHAPE : LOOSE);
  const hint = hintFor(slotType);

  return {
    [toolName(slotType)]: tool({
      description:
        `Emit the ${slotType} block for this slot. ${hint ? "Shape: " + hint + ". " : ""}` +
        `Call this tool EXACTLY ONCE and then stop. It is the only tool you have.`,
      inputSchema: shape,
      execute: async (input: unknown) => {
        const data = (input ?? {}) as Record<string, unknown>;
        await onBlock(slotType, data, text ? String(data.text ?? "") : undefined);
        return { ok: true };
      },
    }),
  };
}

export { toolName };
