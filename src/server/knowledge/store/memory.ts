import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type {
  Concept,
  ConceptAlias,
  ConceptTag,
  Context,
  Statement,
  Provenance,
  Source,
  SourceChunk,
  DependencyEdge,
  CompositionEdge,
  ReinforcementEdge,
  ReviewEvent,
  Release,
  ReleaseMember,
  ReadScope,
  ReviewEffect,
  Program,
  ProgramNode,
  Mapping,
  ClosureCacheEntry,
  TeachingAsset,
  AssessmentItem,
  ItemConcept,
} from "@/server/knowledge/types";
import { resolveSlug as resolveSlugPure, type ConceptLookup } from "@/server/knowledge/concept";
import { contextId } from "@/server/knowledge/context/canonical";
import { applyPolicy } from "@/server/knowledge/trust/policy";
import { similarity } from "@/server/knowledge/trigram";

const sortBy = <T>(rows: T[], key: (row: T) => string): T[] => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
const byId = <T extends { id: string }>(rows: T[]): T[] => sortBy(rows, (r) => r.id);

/**
 * In-memory KnowledgeStore (§5.1 — the reference implementation, written before Postgres).
 * Scope filtering lives HERE, not in callers (§23): a read at scope `tenant:x` sees that
 * tenant's rows plus public; a read at `PUBLIC` sees only public. No delete methods exist
 * (ADR-5). Deterministic and dependency-free, so the conformance suite runs anywhere.
 */
export function createMemoryStore(): KnowledgeStore {
  const concepts = new Map<string, Concept>();
  const aliases: ConceptAlias[] = [];
  const tags: ConceptTag[] = [];
  const statements = new Map<string, Statement>();
  const assets = new Map<string, TeachingAsset>();
  const items = new Map<string, AssessmentItem>();
  const itemConcepts: ItemConcept[] = [];
  const provenance: Provenance[] = [];
  const sources = new Map<string, Source>();
  const sourceChunks = new Map<string, SourceChunk>();
  const dependency: DependencyEdge[] = [];
  const composition: CompositionEdge[] = [];
  const reinforcement: ReinforcementEdge[] = [];
  const reviewEvents: ReviewEvent[] = [];
  const contexts = new Map<string, Context>();
  const releases = new Map<string, Release>();
  const releaseMembers: ReleaseMember[] = [];
  const programs = new Map<string, Program>();
  const programNodes = new Map<string, ProgramNode>();
  const mappings: Mapping[] = [];
  const closures = new Map<string, ClosureCacheEntry>();
  const closureKey = (conceptId: string, releaseId: string) => `${conceptId}@${releaseId}`;

  const visible = (rowScope: string, readScope: ReadScope) => rowScope === "PUBLIC" || rowScope === readScope;

  // A lookup over ONLY the concepts/aliases visible at `scope` — so slug resolution can
  // never cross the tenant boundary either.
  const lookupFor = (scope: ReadScope): ConceptLookup => ({
    byId: (id) => {
      const c = concepts.get(id);
      return c && visible(c.scope, scope) ? c : undefined;
    },
    bySlug: (slug) => [...concepts.values()].find((c) => c.slug === slug && visible(c.scope, scope)),
    formerName: (slug) => {
      const a = aliases.find((x) => x.kind === "FORMER_NAME" && x.alias === slug);
      if (!a) return undefined;
      const c = concepts.get(a.conceptId);
      return c && visible(c.scope, scope) ? a.conceptId : undefined;
    },
  });

  return {
    // ── writes ──
    async putConcept(c) {
      concepts.set(c.id, c);
    },
    async putConceptAlias(a) {
      aliases.push(a);
    },
    async putConceptTag(t) {
      tags.push(t);
    },
    async putStatement(s) {
      statements.set(s.id, s);
    },
    async putTeachingAsset(a) {
      assets.set(a.id, a);
    },
    async putAssessmentItem(item) {
      items.set(item.id, item);
    },
    async putItemConcept(link) {
      itemConcepts.push(link);
    },
    async putProvenance(p) {
      provenance.push(p);
    },
    async putSource(src) {
      sources.set(src.id, src); // content-addressed id — re-ingest overwrites with identical data
    },
    async putSourceChunk(c) {
      sourceChunks.set(c.id, c);
    },
    async putDependencyEdge(e) {
      dependency.push(e);
    },
    async putCompositionEdge(e) {
      composition.push(e);
    },
    async putReinforcementEdge(e) {
      reinforcement.push(e);
    },
    async putReviewEvent(r) {
      reviewEvents.push(r);
    },
    async putRelease(r, members) {
      releases.set(r.id, r);
      releaseMembers.push(...members);
    },
    async commitReview(event, effect: ReviewEffect) {
      // Atomic in memory by construction: append the event and apply the effect together.
      reviewEvents.push(event);
      if (effect.targetKind === "Statement") {
        const s = statements.get(effect.targetId);
        if (s) {
          if (effect.trustLevel) s.trustLevel = effect.trustLevel;
          if (effect.dispute) {
            s.disputed = effect.dispute.disputed;
            s.disputeReason = effect.dispute.reason;
            s.priorTrustLevel = effect.dispute.priorTrustLevel;
            s.disputedAt = effect.dispute.at;
          }
        }
      }
    },
    async putContext(dimensions) {
      const id = contextId(dimensions);
      const existing = contexts.get(id);
      if (existing) return existing; // idempotent by canonical hash (§14.2)
      const row: Context = { id, dimensions };
      contexts.set(id, row);
      return row;
    },
    async putProgram(p) {
      programs.set(p.id, p);
    },
    async putProgramNode(node) {
      programNodes.set(node.id, node);
    },
    async putMapping(m) {
      mappings.push(m);
    },
    async putClosure(entry) {
      closures.set(closureKey(entry.conceptId, entry.releaseId), entry);
    },
    async clearClosures() {
      closures.clear(); // §18 — crude, correct, cheap: any review commit clears the whole cache
    },

    // ── scoped reads ──
    async getConcept(id, scope) {
      const c = concepts.get(id);
      return c && visible(c.scope, scope) ? c : null;
    },
    async resolveSlug(slug, scope) {
      return resolveSlugPure(slug, lookupFor(scope));
    },
    async conceptsByAlias(alias, scope) {
      const ids = new Set(aliases.filter((a) => a.alias === alias).map((a) => a.conceptId));
      return [...ids].map((id) => concepts.get(id)).filter((c): c is NonNullable<typeof c> => !!c && visible(c.scope, scope));
    },
    async trigramConcepts(text, scope, threshold = 0.3) {
      const aliasByConcept = new Map<string, string[]>();
      for (const a of aliases) (aliasByConcept.get(a.conceptId) ?? aliasByConcept.set(a.conceptId, []).get(a.conceptId)!).push(a.alias);
      const out: { concept: Concept; score: number; matchedOn: string }[] = [];
      for (const c of concepts.values()) {
        if (!visible(c.scope, scope)) continue;
        let best = similarity(text, c.name);
        let matchedOn = `name:${c.name}`;
        for (const al of aliasByConcept.get(c.id) ?? []) {
          const s = similarity(text, al);
          if (s > best) { best = s; matchedOn = `alias:${al}`; }
        }
        if (best >= threshold) out.push({ concept: c, score: best, matchedOn });
      }
      return out.sort((a, b) => b.score - a.score || (a.concept.id < b.concept.id ? -1 : 1));
    },
    async listConcepts(scope) {
      return [...concepts.values()].filter((c) => visible(c.scope, scope));
    },
    async mappingsForConcept(conceptId) {
      return mappings.filter((m) => m.conceptId === conceptId);
    },
    async mappingsUnderNode(programNodeId) {
      return mappings.filter((m) => m.programNodeId === programNodeId);
    },
    async getClosure(conceptId, releaseId) {
      return closures.get(closureKey(conceptId, releaseId)) ?? null;
    },
    async getContext(id) {
      return contexts.get(id) ?? null;
    },
    async getStatementRaw(id) {
      return statements.get(id) ?? null;
    },
    async provenanceFor(statementId) {
      return provenance.filter((p) => p.statementId === statementId);
    },
    async getSource(id) {
      return sources.get(id) ?? null;
    },
    async getSourceChunk(id) {
      return sourceChunks.get(id) ?? null;
    },
    async listSources() {
      return [...sources.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    async chunksForSource(sourceId) {
      return [...sourceChunks.values()].filter((c) => c.sourceId === sourceId).sort((a, b) => a.ordinal - b.ordinal);
    },
    async reviewEventsFor(targetKind, targetId) {
      return reviewEvents.filter((r) => r.targetKind === targetKind && r.targetId === targetId);
    },

    // ── content reads (scope + DISPUTED suspension + trust) ──
    // A disputed statement is never served, at any level (§26.5) — the flag is checked
    // BEFORE the trust policy, because no `minimum` is ever low enough to admit it.
    async getStatement(id, scope, policy) {
      const s = statements.get(id);
      if (!s || !visible(s.scope, scope) || s.disputed) return null;
      return applyPolicy([s], policy)[0] ?? null;
    },
    async statementsForSubject(subjectId, scope, policy) {
      const rows = [...statements.values()].filter((s) => s.subjectId === subjectId && visible(s.scope, scope) && !s.disputed);
      return applyPolicy(rows, policy);
    },
    async assetsForConcept(conceptId, scope, policy) {
      const rows = [...assets.values()].filter((a) => a.conceptId === conceptId && visible(a.scope, scope));
      return applyPolicy(rows, policy);
    },
    async itemsForConcept(conceptId, scope, policy) {
      const itemIds = new Set(itemConcepts.filter((l) => l.conceptId === conceptId).map((l) => l.itemId));
      const rows = [...items.values()].filter((i) => itemIds.has(i.id) && visible(i.scope, scope));
      return applyPolicy(rows, policy);
    },
    async releaseMembersOf(releaseId) {
      return releaseMembers.filter((m) => m.releaseId === releaseId);
    },

    // ── whole-graph reads ──
    async dependencyEdges() {
      return [...dependency];
    },
    async compositionEdges() {
      return [...composition];
    },
    async reinforcementEdges() {
      return [...reinforcement];
    },

    // ── whole-graph dump (export / restore / integrity) — deterministic, sorted by id ──
    async dumpAll() {
      return {
        concepts: byId([...concepts.values()]),
        conceptAliases: sortBy(aliases, (a) => `${a.conceptId}|${a.alias}`),
        conceptTags: sortBy(tags, (t) => `${t.conceptId}|${t.namespace}|${t.value}`),
        contexts: byId([...contexts.values()]),
        statements: byId([...statements.values()]),
        provenance: sortBy(provenance, (p) => `${p.statementId}|${p.chunkId}`),
        sources: byId([...sources.values()]),
        sourceChunks: byId([...sourceChunks.values()]),
        dependencyEdges: sortBy(dependency, (e) => `${e.fromId}|${e.toId}|${e.version}`),
        compositionEdges: sortBy(composition, (e) => `${e.partId}|${e.wholeId}|${e.version}`),
        reinforcementEdges: sortBy(reinforcement, (e) => `${e.fromId}|${e.toId}|${e.type}|${e.version}`),
        reviewEvents: byId(reviewEvents),
        teachingAssets: byId([...assets.values()]),
        assessmentItems: byId([...items.values()]),
        itemConcepts: sortBy(itemConcepts, (l) => `${l.itemId}|${l.conceptId}`),
        programs: byId([...programs.values()]),
        programNodes: byId([...programNodes.values()]),
        mappings: sortBy(mappings, (m) => `${m.programNodeId}|${m.conceptId}`),
        releases: byId([...releases.values()]),
        releaseMembers: sortBy(releaseMembers, (m) => `${m.releaseId}|${m.kind}|${m.entityId}`),
      };
    },
  };
  // Note: `tags`, `releaseMembers` and `releases` accept writes now (so M0's one gated
  // push is the last schema interruption — A-2); their dedicated reads arrive with M4
  // search and M9 replay.
}
