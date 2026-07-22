import { prisma } from "@/server/db";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type {
  Concept,
  Statement,
  Provenance,
  DependencyEdge,
  CompositionEdge,
  ReinforcementEdge,
  ReviewEvent,
  ReadScope,
  Scope,
  ConceptStatus,
  StatementForm,
  TrustLevel,
  ReinforcementType,
} from "@/server/knowledge/types";
import { resolveSlug as resolveSlugPure, type ConceptLookup } from "@/server/knowledge/concept";
import { contextId } from "@/server/knowledge/context/canonical";
import { applyPolicy } from "@/server/knowledge/trust/policy";

/**
 * The Postgres KnowledgeStore. THE ONLY module under knowledge/ that imports Prisma
 * (wall W5) — everything else is engine-agnostic and would survive a database swap. It
 * mirrors the in-memory store's semantics exactly (that parity is what the conformance
 * suite proves): scope filtered here (§23), trust applied read-time (§26.4), no delete.
 *
 * The §10 schema uses plain String FK columns (no Prisma @relation), so mapping is a
 * near-identity — the casts below are the storage boundary re-asserting the unions the
 * store trusts on its own rows (validation happened on write).
 */

// Rows a tenant may read: its own plus public. Applied in SQL so the index is used.
const scopeWhere = (scope: ReadScope) => ({ scope: { in: ["PUBLIC", scope] } });

export function createPostgresStore(): KnowledgeStore {
  return {
    // ── writes ──
    async putConcept(c) {
      await prisma.concept.create({ data: c });
    },
    async putConceptAlias(a) {
      await prisma.conceptAlias.create({ data: a });
    },
    async putConceptTag(t) {
      await prisma.conceptTag.create({ data: t });
    },
    async putStatement(s) {
      await prisma.statement.create({ data: { ...s, structure: s.structure as object, payload: s.payload as object } });
    },
    async putProvenance(p) {
      await prisma.provenance.create({ data: { ...p, locator: p.locator as object } });
    },
    async putDependencyEdge(e) {
      await prisma.dependencyEdge.create({ data: e });
    },
    async putCompositionEdge(e) {
      await prisma.compositionEdge.create({ data: e });
    },
    async putReinforcementEdge(e) {
      await prisma.reinforcementEdge.create({ data: e });
    },
    async putReviewEvent(r) {
      await prisma.reviewEvent.create({
        data: { ...r, before: r.before as object, after: r.after as object },
      });
    },
    async putRelease(release, members) {
      await prisma.$transaction([
        prisma.release.create({ data: release }),
        prisma.releaseMember.createMany({ data: members }),
      ]);
    },
    async putContext(dimensions) {
      const id = contextId(dimensions);
      // Idempotent by canonical hash (§14.2): same dimensions → same row, never a duplicate.
      const row = await prisma.context.upsert({
        where: { id },
        create: { id, dimensions: dimensions as object },
        update: {},
      });
      return { id: row.id, dimensions: row.dimensions as Record<string, unknown> };
    },

    // ── scoped reads ──
    async getConcept(id, scope) {
      const r = await prisma.concept.findFirst({ where: { id, ...scopeWhere(scope) } });
      return r ? toConcept(r) : null;
    },
    async resolveSlug(slug, scope) {
      // Slug resolution follows tombstone chains (§18A.4); snapshot the visible concepts +
      // FORMER_NAME aliases once, then resolve purely — scope filtering stays inside the store.
      const [concepts, aliases] = await Promise.all([
        prisma.concept.findMany({ where: scopeWhere(scope) }),
        prisma.conceptAlias.findMany({ where: { kind: "FORMER_NAME" } }),
      ]);
      const byId = new Map(concepts.map((c) => [c.id, toConcept(c)]));
      const lookup: ConceptLookup = {
        byId: (id) => byId.get(id),
        bySlug: (s) => [...byId.values()].find((c) => c.slug === s),
        formerName: (s) => {
          const a = aliases.find((x) => x.alias === s);
          return a && byId.has(a.conceptId) ? a.conceptId : undefined;
        },
      };
      return resolveSlugPure(slug, lookup);
    },
    async listConcepts(scope) {
      return (await prisma.concept.findMany({ where: scopeWhere(scope) })).map(toConcept);
    },
    async getContext(id) {
      const r = await prisma.context.findUnique({ where: { id } });
      return r ? { id: r.id, dimensions: r.dimensions as Record<string, unknown> } : null;
    },
    async provenanceFor(statementId) {
      return (await prisma.provenance.findMany({ where: { statementId } })).map(toProvenance);
    },
    async reviewEventsFor(targetKind, targetId) {
      return (await prisma.reviewEvent.findMany({ where: { targetKind, targetId } })).map(toReviewEvent);
    },

    // ── content reads (scope in SQL, trust applied read-time — parity with memory) ──
    async getStatement(id, scope, policy) {
      const r = await prisma.statement.findFirst({ where: { id, ...scopeWhere(scope) } });
      if (!r) return null;
      return applyPolicy([toStatement(r)], policy)[0] ?? null;
    },
    async statementsForSubject(subjectId, scope, policy) {
      const rows = await prisma.statement.findMany({ where: { subjectId, ...scopeWhere(scope) } });
      return applyPolicy(rows.map(toStatement), policy);
    },

    // ── whole-graph reads ──
    async dependencyEdges() {
      return (await prisma.dependencyEdge.findMany()).map(toDependencyEdge);
    },
    async compositionEdges() {
      return (await prisma.compositionEdge.findMany()).map(toCompositionEdge);
    },
    async reinforcementEdges() {
      return (await prisma.reinforcementEdge.findMany()).map(toReinforcementEdge);
    },
  };
}

// ── row → domain mappers (the storage boundary; casts re-assert the unions) ──
type Row = Record<string, unknown>;

function toConcept(r: Row): Concept {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    kind: r.kind as string,
    scope: r.scope as Scope,
    status: r.status as ConceptStatus,
    version: r.version as number,
    supersedes: (r.supersedes as string | null) ?? null,
    mergedInto: (r.mergedInto as string | null) ?? null,
    splitInto: (r.splitInto as string[]) ?? [],
    createdAt: r.createdAt as Date,
  };
}

function toStatement(r: Row): Statement {
  return {
    id: r.id as string,
    kind: r.kind as string,
    form: r.form as StatementForm,
    structure: r.structure as Record<string, unknown>,
    subjectId: (r.subjectId as string | null) ?? null,
    predicate: (r.predicate as string | null) ?? null,
    objectId: (r.objectId as string | null) ?? null,
    objectLit: (r.objectLit as string | null) ?? null,
    text: r.text as string,
    payload: r.payload as Record<string, unknown>,
    contextId: r.contextId as string,
    scope: r.scope as Scope,
    trustLevel: r.trustLevel as TrustLevel,
    validationMethods: (r.validationMethods as string[]) ?? [],
    corroborationCount: r.corroborationCount as number,
    independentSourceCount: r.independentSourceCount as number,
    derivedFrom: (r.derivedFrom as string[]) ?? [],
    authority: (r.authority as string | null) ?? null,
    evidenceLevel: (r.evidenceLevel as string | null) ?? null,
    version: r.version as number,
    supersedes: (r.supersedes as string | null) ?? null,
    createdAt: r.createdAt as Date,
  };
}

function toProvenance(r: Row): Provenance {
  return {
    statementId: r.statementId as string,
    sourceId: r.sourceId as string,
    chunkId: r.chunkId as string,
    locator: r.locator,
    quote: r.quote as string,
    extractorVersion: r.extractorVersion as string,
    promptVersion: r.promptVersion as string,
    modelId: r.modelId as string,
    extractedAt: r.extractedAt as Date,
  };
}

function toReviewEvent(r: Row): ReviewEvent {
  return {
    id: r.id as string,
    targetKind: r.targetKind as string,
    targetId: r.targetId as string,
    decision: r.decision as string,
    fromTrust: (r.fromTrust as TrustLevel | null) ?? null,
    toTrust: (r.toTrust as TrustLevel | null) ?? null,
    actorId: r.actorId as string,
    before: r.before,
    after: r.after,
    reason: (r.reason as string | null) ?? null,
    batchId: (r.batchId as string | null) ?? null,
    createdAt: r.createdAt as Date,
  };
}

function toDependencyEdge(r: Row): DependencyEdge {
  return {
    fromId: r.fromId as string,
    toId: r.toId as string,
    strength: r.strength as number,
    contextId: (r.contextId as string | null) ?? null,
    version: r.version as number,
    supersedes: (r.supersedes as string | null) ?? null,
  };
}

function toCompositionEdge(r: Row): CompositionEdge {
  return {
    partId: r.partId as string,
    wholeId: r.wholeId as string,
    ordinal: (r.ordinal as number | null) ?? null,
    version: r.version as number,
  };
}

function toReinforcementEdge(r: Row): ReinforcementEdge {
  return {
    fromId: r.fromId as string,
    toId: r.toId as string,
    type: r.type as ReinforcementType,
    strength: r.strength as number,
    earned: r.earned as boolean,
    contextId: (r.contextId as string | null) ?? null,
    version: r.version as number,
  };
}
