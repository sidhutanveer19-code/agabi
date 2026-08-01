import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { ReadScope } from "@/server/knowledge/types";

/**
 * Duplicate-concept detector (W7, gap E-backend). Reuses the store's trigram similarity (rung 3,
 * M6) — never a new algorithm. Surfaces concept pairs that are near-duplicates (same idea entered
 * twice), the input to the merge queue. NEVER auto-merges (ADR-10): a wrong merge is silent and
 * worse than a visible duplicate — a human decides. Derived, read-only, deterministic.
 */
export interface DuplicatePair {
  a: string; // concept id (lexicographically first)
  b: string;
  score: number;
}

export async function detectDuplicates(store: KnowledgeStore, scope: ReadScope, threshold = 0.6): Promise<DuplicatePair[]> {
  const concepts = await store.listConcepts(scope);
  const pairs = new Map<string, DuplicatePair>();
  for (const c of concepts) {
    for (const m of await store.trigramConcepts(c.name, scope, threshold)) {
      if (m.concept.id === c.id) continue;
      const [a, b] = [c.id, m.concept.id].sort();
      const key = `${a}|${b}`;
      if (!pairs.has(key)) pairs.set(key, { a, b, score: m.score });
    }
  }
  return [...pairs.values()].sort((x, y) => y.score - x.score || x.a.localeCompare(y.a));
}
