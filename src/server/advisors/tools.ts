import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * The batch fill tool (Groq / tool-calling path). Imports ONLY `ai` + `zod` — no
 * conversation, no coerce, no writer (advisor wall). The boundary is permissive by
 * design: it captures whatever the model sends and forwards it via `onFill`. It
 * does NOT judge emptiness or shape — that is conversation's `accept()`/coerce
 * step. The advisor only produces raw proposals.
 */
export interface BatchTool {
  tools: ToolSet;
}

/** Field descriptions are MANDATORY — weak models refuse a tool whose field shapes
 *  they can't see (proven on Ollama qwen2.5:7b). */
export const BATCH_FIELD_DESCRIPTIONS = {
  slot: "The slot number from the lesson plan you are filling.",
  data: "The block content. Shape depends on this slot's type — see the plan.",
  text: "For text blocks (heading, paragraph, callout, summary): the prose.",
} as const;

/**
 * One tool, called once per slot inside a single `streamText` (the system prompt is
 * paid once). `onFill(slot, data, text)` receives the RAW payload; production
 * validates + coerces + writes. The tool dedups repeat slots (advisor-internal) but
 * never checks content — an empty payload is production's to reject.
 */
export function buildBatchTool(
  slots: { slot: number }[],
  onFill: (slot: number, data: Record<string, unknown>, text: string) => void | Promise<void>,
): BatchTool {
  const valid = new Set(slots.map((s) => s.slot));
  const filled = new Set<number>();

  const t = tool({
    description:
      "Fill the lesson's blocks. Call this tool ONCE PER SLOT listed in the plan, " +
      "passing that slot's number and its content. Stop when every slot is filled.",
    inputSchema: z
      .object({
        slot: z.union([z.number(), z.string()]).describe(BATCH_FIELD_DESCRIPTIONS.slot),
        data: z.object({}).passthrough().optional().describe(BATCH_FIELD_DESCRIPTIONS.data),
        text: z.string().optional().describe(BATCH_FIELD_DESCRIPTIONS.text),
      })
      .passthrough(),
    execute: async (input) => {
      const n = typeof input.slot === "number" ? input.slot : parseInt(String(input.slot ?? ""), 10);
      if (!Number.isFinite(n) || !valid.has(n)) {
        return { ok: false, error: `Unknown slot. Fill one of: ${[...valid].join(", ")}.` };
      }
      if (filled.has(n)) return { ok: false, error: `Slot ${n} already filled. Move to another slot.` };
      filled.add(n);
      await onFill(n, (input.data ?? {}) as Record<string, unknown>, typeof input.text === "string" ? input.text : "");
      return { ok: true, filled: filled.size };
    },
  });

  return { tools: { emit_block: t } };
}
