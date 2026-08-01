import { advise, type Advice } from "@/server/advisors/advice";
import { dependenciesPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * Pass 3 — dependencies (§12.4). Proposes classified relationships (REQUIRES / PART_OF /
 * REINFORCEMENT) between known concepts. The classification is ALWAYS human-confirmed
 * downstream (V9) regardless of trust — that is what keeps the DAG honest. Untrusted
 * `Advice`; unwrapped with `RawDependenciesSchema`.
 */
export async function extractDependencies(chunkText: string, entityNames: string[], invoke: JsonInvoke): Promise<Advice<unknown>> {
  const { system, user } = dependenciesPrompt(chunkText, entityNames);
  const { data } = await invoke(system, user);
  return advise((data as { dependencies?: unknown }).dependencies ?? []);
}
