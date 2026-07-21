import { tool } from "ai";
import { z } from "zod";
import { TEXT_ONLY_TYPES, VISUAL_ONLY_TYPES } from "@/server/ai/blockTypes";

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
