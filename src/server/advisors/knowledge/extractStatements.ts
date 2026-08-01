import { advise, type Advice } from "@/server/advisors/advice";
import { statementsPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * Pass 2 — statements (§12.4). Given a chunk and the resolved entity names, propose
 * assertions, each carrying an EXACT quote (V3 checks it literally) and OWN-WORDS text
 * (V5 guards copyright). Untrusted `Advice`; unwrapped with `RawStatementsSchema`.
 */
export async function extractStatements(chunkText: string, entityNames: string[], invoke: JsonInvoke, hint = ""): Promise<Advice<unknown>> {
  const { system, user } = statementsPrompt(chunkText, entityNames, hint);
  const { data } = await invoke(system, user);
  return advise((data as { statements?: unknown }).statements ?? []);
}
