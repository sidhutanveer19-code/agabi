import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { BLOCK_HINTS } from "@/server/ai/blockTypes";
import { isText } from "@/server/ai/outline";
import { hasMeaningfulPayload } from "@/server/ai/coerce";
import type { OnBlock } from "@/server/ai/blockTools";

/**
 * Per-slot tool. TWO INVARIANTS, enforced here — not requested of the model:
 *
 *  1. The tool boundary NEVER rejects. `inputSchema` is permissive ON PURPOSE.
 *     A rejected call means execute never runs, which means the adaptBlock
 *     ladder never runs, which means a HOLE. Strictness lives inside execute,
 *     where failure is repairable.
 *
 *  2. Exactly one block per slot. Extra calls refused; zero calls backfilled
 *     by the caller via didEmit().
 */

/** Permissive by design. DO NOT TIGHTEN. See invariant 1. */
const OPEN = z.object({}).passthrough();

/** Strict shapes used ONLY as post-acceptance guidance, never as a gate. */
const STRICT: Record<string, z.ZodTypeAny> = {
  mindmap: z.object({ markdown: z.string().min(3) }),
  timeline: z.object({ items: z.array(z.object({
    id: z.union([z.number(), z.string()]),
    content: z.string(),
    start: z.string(),
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
    points: z.array(z.object({
      id: z.string(), x: z.number(), y: z.number(), name: z.string(),
    })).min(2),
    segments: z.array(z.array(z.string()).length(2)).min(1),
  }),
};

const hintFor = (type: string) =>
  BLOCK_HINTS[type] ??
  Object.entries(BLOCK_HINTS).find(([k]) => k.includes(type))?.[1] ??
  "";

export const toolName = (type: string) => `emit_${type.replace(/-/g, "_")}`;

export interface SlotTool {
  tools: ToolSet;
  didEmit: () => boolean;
  notes: () => string[];
}

export function buildSlotTool(slotType: string, onBlock: OnBlock): SlotTool {
  const text = isText(slotType);
  const hint = hintFor(slotType);
  let emitted = false;
  const notes: string[] = [];

  const t = tool({
    description:
      `Emit the ${slotType} block for this slot. ` +
      (hint ? `Shape: ${hint}. ` : "") +
      `Call this tool EXACTLY ONCE, then stop. It is the only tool you have.`,
    inputSchema: OPEN,
    execute: async (input: unknown) => {
      if (emitted) {
        return { ok: false, error: "This slot already has its block. Stop calling." };
      }
      const data = (input ?? {}) as Record<string, unknown>;
      const rawText = typeof data.text === "string" ? data.text : "";

      // Refuse an empty payload — an empty focused-retry must not mark the slot
      // resolved, or the route would stop before RUNG 3 / coerce (hollow lesson).
      if (!hasMeaningfulPayload(rawText, data)) {
        return { ok: false, error: "This slot needs actual content. Send the data matching its type." };
      }

      const strict = STRICT[slotType];
      if (strict) {
        const r = strict.safeParse(data);
        if (!r.success) notes.push(`${slotType}: ${r.error.issues[0]?.message ?? "shape mismatch"}`);
      }

      emitted = true;
      await onBlock(slotType, data, text ? String(data.text ?? "") : undefined);
      return { ok: true };
    },
  });

  return { tools: { [toolName(slotType)]: t }, didEmit: () => emitted, notes: () => notes };
}
