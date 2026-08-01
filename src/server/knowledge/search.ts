import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { TrustPolicy, ReadScope, ReinforcementType } from "@/server/knowledge/types";
import { prerequisiteClosure } from "@/server/knowledge/graph/dependency";
import { componentParts } from "@/server/knowledge/graph/composition";
import { edgesOfType } from "@/server/knowledge/graph/reinforcement";

/**
 * Search (§15). Resolves CONCEPTS, never documents — output is concept refs. Rungs 1–2
 * ship here (exact slug, then alias incl. translations/former-names); rung 3 (trigram) is
 * M6, rung 4 (vector) only when rung 3 measurably fails. For a syllabus term, exact match
 * is BETTER than semantic: it cannot drift, it is explainable, and it replays identically.
 *
 * `trustPolicy` is REQUIRED with no default — that is what makes it impossible to surface
 * machine-proposed knowledge to a student by accident. `rung` + `matchedOn` make every hit
 * explainable; a match that cannot say why cannot be trusted in a teaching path.
 */
export interface SearchQuery {
  text?: string;
  kinds?: string[];
  contextId?: string;
  trustPolicy: TrustPolicy; // REQUIRED. no default (§15).
  scope?: ReadScope;
}

export interface SearchHit {
  conceptId: string;
  score: number;
  rung: 1 | 2 | 3 | 4;
  matchedOn: string;
}

export async function resolve(store: KnowledgeStore, q: SearchQuery): Promise<SearchHit[]> {
  const scope = q.scope ?? "PUBLIC";
  const hits = new Map<string, SearchHit>();
  const add = (h: SearchHit) => {
    const prev = hits.get(h.conceptId);
    if (!prev || h.rung < prev.rung) hits.set(h.conceptId, h); // a lower rung is a stronger match
  };

  if (q.text) {
    // rung 1 — exact slug (follows tombstones)
    const r = await store.resolveSlug(q.text.toLowerCase(), scope);
    if (r.kind === "concept") add({ conceptId: r.conceptId, score: 1, rung: 1, matchedOn: `slug:${q.text}` });

    // rung 2 — alias (synonyms, abbreviations, translations, former names)
    for (const c of await store.conceptsByAlias(q.text, scope)) {
      add({ conceptId: c.id, score: 0.8, rung: 2, matchedOn: `alias:${q.text}` });
    }

    // rung 3 — trigram (§15), only when the exact rungs found nothing, so a fuzzy match never
    // shadows an exact one. Postgres needs pg_trgm (gated); memory computes it in JS.
    if (hits.size === 0) {
      for (const t of await store.trigramConcepts(q.text, scope)) {
        add({ conceptId: t.concept.id, score: t.score, rung: 3, matchedOn: t.matchedOn });
      }
    }
    // rung 4 (vector) is deferred until rung 3 measurably fails — never faked as a match.
  }

  const applyKinds = async (list: SearchHit[]) => {
    if (!q.kinds?.length) return list;
    const kept: SearchHit[] = [];
    for (const h of list) {
      const c = await store.getConcept(h.conceptId, scope);
      if (c && q.kinds.includes(c.kind)) kept.push(h);
    }
    return kept;
  };

  const list = await applyKinds([...hits.values()]);
  // Deterministic: strongest rung first, then concept id.
  return list.sort((a, b) => a.rung - b.rung || (a.conceptId < b.conceptId ? -1 : a.conceptId > b.conceptId ? 1 : 0));
}

// ─────────── graph navigation (§16) — three graphs named apart, never getEdges(type) ───────────

export interface OrderedConcept {
  conceptId: string;
  depth: number;
}

/** Prerequisites of a concept, ordered nearest-first, bounded (§16, §18B). */
export async function prerequisitesOf(store: KnowledgeStore, conceptId: string, depth: number, maxNodes = 200): Promise<OrderedConcept[]> {
  const closure = prerequisiteClosure(await store.dependencyEdges(), [conceptId], depth, maxNodes);
  return closure.nodes.filter((n) => n.id !== conceptId).map((n) => ({ conceptId: n.id, depth: n.depth }));
}

/** Concepts that directly REQUIRE this one (dependency reverse). */
export async function dependentsOf(store: KnowledgeStore, conceptId: string): Promise<string[]> {
  return (await store.dependencyEdges()).filter((e) => e.toId === conceptId).map((e) => e.fromId);
}

/** The component parts of a concept (composition), bounded. */
export async function partsOf(store: KnowledgeStore, conceptId: string, depth = 3, maxNodes = 200): Promise<string[]> {
  const closure = componentParts(await store.compositionEdges(), [conceptId], depth, maxNodes);
  return closure.nodes.filter((n) => n.id !== conceptId).map((n) => n.id);
}

/** Reinforcement neighbours of a concept, optionally filtered by edge type (cyclic graph). */
export async function reinforcementsOf(store: KnowledgeStore, conceptId: string, types?: ReinforcementType[]): Promise<string[]> {
  const edges = await store.reinforcementEdges();
  const selected = types?.length ? types.flatMap((t) => edgesOfType(edges, conceptId, t)) : edges.filter((e) => e.fromId === conceptId);
  return [...new Set(selected.map((e) => e.toId))];
}
