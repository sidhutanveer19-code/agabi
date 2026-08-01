import { advise, type Advice } from "@/server/advisors/advice";
import { assetsPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * Pass 4 — teaching assets (§12.4). Runs ONLY over verified knowledge (the caller passes
 * concepts from a knowledge-verified chapter). Proposes misconceptions, analogies and worked
 * examples; the ANALOGY breakdown point is enforced downstream by V14. Untrusted `Advice`;
 * unwrapped with `RawAssetsSchema`.
 */
export async function extractAssets(chunkText: string, entityNames: string[], invoke: JsonInvoke): Promise<Advice<unknown>> {
  const { system, user } = assetsPrompt(chunkText, entityNames);
  const { data } = await invoke(system, user);
  return advise((data as { assets?: unknown }).assets ?? []);
}
