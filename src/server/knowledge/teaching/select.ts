import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { TeachingAsset, Labelled, ReadScope, TrustPolicy } from "@/server/knowledge/types";
import { hasCapability, type AssetCapability } from "@/server/knowledge/teaching/registry";

/**
 * Asset selection (§13, §18C.1). Selection is trust + context + recency — NO adaptation loop
 * (that is Phase 3, X3). Assets come from the store already scope- and trust-gated; here we
 * rank them: an exact context match first, then the rest, newest version first. Consumers pick
 * by CAPABILITY (`withCapability`), never by switching on kind.
 *
 * `miss` is true when the concepts have no servable asset — the Teaching Engine then falls back
 * to model-generated presentation, clearly marked, and records `teaching.miss` (§13.1).
 */
export interface AssetSelection {
  assets: Labelled<TeachingAsset>[];
  miss: boolean;
}

export async function assetsFor(
  store: KnowledgeStore,
  conceptIds: string[],
  scope: ReadScope,
  policy: TrustPolicy,
  queryContextId?: string,
): Promise<AssetSelection> {
  const all: Labelled<TeachingAsset>[] = [];
  for (const conceptId of conceptIds) all.push(...(await store.assetsForConcept(conceptId, scope, policy)));

  const rank = (a: Labelled<TeachingAsset>) => (queryContextId && a.contextId === queryContextId ? 0 : 1);
  const assets = [...all].sort((a, b) => rank(a) - rank(b) || b.version - a.version || (a.id < b.id ? -1 : 1));
  return { assets, miss: assets.length === 0 };
}

/** Capability dispatch (§18C.1): filter by what an asset CAN DO, never by its kind. */
export function withCapability(assets: Labelled<TeachingAsset>[], capability: AssetCapability): Labelled<TeachingAsset>[] {
  return assets.filter((a) => hasCapability(a.kind, capability));
}
