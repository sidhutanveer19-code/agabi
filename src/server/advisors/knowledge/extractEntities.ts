import { advise, type Advice } from "@/server/advisors/advice";
import { entitiesPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * Pass 1 — entities (§12.4). Resolution-before-creation happens on the knowledge side; the
 * advisor only PROPOSES concept candidates from a chunk. Returns `Advice<unknown>`: raw,
 * untrusted, with no trust field to claim. The knowledge side unwraps via
 * `accept(advice, RawEntitiesSchema)` — the only path across the boundary.
 */
export async function extractEntities(chunkText: string, invoke: JsonInvoke): Promise<Advice<unknown>> {
  const { system, user } = entitiesPrompt(chunkText);
  const { data } = await invoke(system, user);
  return advise((data as { entities?: unknown }).entities ?? []);
}
