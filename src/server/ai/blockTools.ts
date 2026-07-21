import { tool } from "ai";
import { z } from "zod";
import { BLOCK_TYPES } from "@/server/ai/blockTypes";

/**
 * The one tool the model calls to build a lesson. Flat schema (type + data +
 * optional streamText) — weak free models handle this far better than a many-branch
 * anyOf union; the server-side adapt/validate ladder (validateBlock) is what
 * guarantees a well-formed block. Per-type shapes live in the system prompt (D1).
 */
export type OnBlock = (type: string, data: Record<string, unknown>, streamText?: string) => Promise<void>;

export function buildTools(onBlock: OnBlock) {
  return {
    emit_block: tool({
      description:
        "Emit ONE educational block onto the lesson canvas. Call it repeatedly, in reading order, to build the whole lesson. `type` must be one of the known block types and `data` must match that type's shape (given in the system prompt). Pass optional `streamText` as the human-readable text of the block.",
      inputSchema: z.object({
        type: z.enum([...BLOCK_TYPES] as [string, ...string[]]),
        data: z.record(z.string(), z.unknown()).default({}),
        streamText: z.string().optional(),
      }),
      execute: async ({ type, data, streamText }) => {
        await onBlock(type, data as Record<string, unknown>, streamText);
        return { ok: true };
      },
    }),
  };
}
