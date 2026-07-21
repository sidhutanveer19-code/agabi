import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { TEXT_ONLY_TYPES, VISUAL_ONLY_TYPES } from "@/server/ai/blockTypes";
import { hasMeaningfulPayload } from "@/server/ai/coerce";

export type OnBlock = (type: string, data: Record<string, unknown>, streamText?: string) => Promise<void>;

const TEXT_BUDGET = 4;
const VISUAL_TARGET = 3;

export function buildTools(onBlock: OnBlock) {
  let textUsed = 0;
  let visualsUsed = 0;

  return {
    emit_text: tool({
      description:
        `Emit ONE text block (heading, paragraph, bullet list, callout, summary). ` +
        `You have ${TEXT_BUDGET} of these for the whole lesson — spend them carefully. ` +
        `Pass the prose in \`text\`.`,
      inputSchema: z.object({
        type: z.enum([...TEXT_ONLY_TYPES] as [string, ...string[]]),
        text: z.string(),
      }),
      execute: async ({ type, text }) => {
        if (textUsed >= TEXT_BUDGET && visualsUsed < VISUAL_TARGET) {
          return {
            ok: false,
            error: `Text budget spent (${textUsed}/${TEXT_BUDGET}) and only ${visualsUsed}/${VISUAL_TARGET} visuals emitted. Call emit_visual now — do not call emit_text again until you have ${VISUAL_TARGET} visuals.`,
          };
        }
        textUsed++;
        await onBlock(type, { text }, text);
        return { ok: true, textUsed, visualsUsed, textBudgetLeft: TEXT_BUDGET - textUsed };
      },
    }),

    emit_visual: tool({
      description:
        `Emit ONE visual block (chart, table, mermaid, flow, timeline, mindmap, formula, graph, geometry, basic-diagram, map, molecule…). ` +
        `At least ${VISUAL_TARGET} are required per lesson. \`data\` must match the shape given in the system prompt.`,
      inputSchema: z.object({
        type: z.enum([...VISUAL_ONLY_TYPES] as [string, ...string[]]),
        data: z.record(z.string(), z.unknown()).default({}),
      }),
      execute: async ({ type, data }) => {
        visualsUsed++;
        await onBlock(type, data as Record<string, unknown>);
        return { ok: true, textUsed, visualsUsed };
      },
    }),
  };
}

// ── RUNG 1 — batch fill ──────────────────────────────────────────────────────
export interface BatchTool {
  tools: ToolSet;
  filledSlots: () => Set<number>;
}

/** Field descriptions for the batch tool. Weak models refuse a tool whose field
 *  shapes they can't see (proven on Ollama qwen2.5:7b) — these are MANDATORY. */
export const BATCH_FIELD_DESCRIPTIONS = {
  slot: "The slot number from the lesson plan you are filling.",
  data: "The block content. Shape depends on this slot's type — see the plan.",
  text: "For text blocks (heading, paragraph, callout, summary): the prose.",
} as const;

/**
 * One tool, called once per slot INSIDE A SINGLE streamText — the system prompt
 * is paid once, not once-per-slot (the 5× token collapse). Boundary is permissive
 * by design (never rejects on shape → the coerce ladder always runs). But it DOES
 * refuse an EMPTY payload: an empty fill must not mark a slot resolved, or
 * authorRate would score a lesson of empty shells at 1.0. `onFill` records the raw
 * payload (route buffers + coerces + flushes in order); the tool never emits.
 */
export function buildBatchTool(
  outline: { slot: number; type: string }[],
  onFill: (slot: number, data: Record<string, unknown>, text: string) => void | Promise<void>,
): BatchTool {
  const valid = new Set(outline.map((s) => s.slot));
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
      const text = typeof input.text === "string" ? input.text.trim() : "";
      const data = (input.data ?? {}) as Record<string, unknown>;
      if (!hasMeaningfulPayload(text, data)) {
        return { ok: false, error: `Slot ${n} needs actual content. Send the data matching that slot's type.` };
      }
      filled.add(n);
      await onFill(n, data, text);
      return { ok: true, filled: filled.size };
    },
  });

  return { tools: { emit_block: t }, filledSlots: () => filled };
}
