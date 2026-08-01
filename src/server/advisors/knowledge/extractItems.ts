import { advise, type Advice } from "@/server/advisors/advice";
import { itemsPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * Assessment-item extraction (M9). Proposes MCQ/SHORT/NUMERIC items over known concepts; MCQ
 * distractors name the misconception they diagnose (§13.2). Untrusted `Advice`; unwrapped with
 * `RawItemsSchema`, then kind-validated by the assessment registry.
 */
export async function extractItems(chunkText: string, entityNames: string[], invoke: JsonInvoke): Promise<Advice<unknown>> {
  const { system, user } = itemsPrompt(chunkText, entityNames);
  const { data } = await invoke(system, user);
  return advise((data as { items?: unknown }).items ?? []);
}
