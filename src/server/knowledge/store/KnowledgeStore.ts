import type {
  Concept,
  ConceptAlias,
  ConceptTag,
  Context,
  Statement,
  Provenance,
  DependencyEdge,
  CompositionEdge,
  ReinforcementEdge,
  ReviewEvent,
  Release,
  ReleaseMember,
  ReadScope,
  TrustPolicy,
  Labelled,
  SlugResolution,
} from "@/server/knowledge/types";

/**
 * The knowledge storage boundary (§5.1, §17). Written and conformance-tested against an
 * in-memory implementation FIRST, so the interface stays storage-agnostic — an interface
 * designed against Prisma smuggles Prisma-shaped assumptions in. Postgres is one impl
 * behind this seam (ADR-4, §17.2); swapping engines costs one file.
 *
 * Two invariants the interface itself encodes:
 *  · **No delete path** (ADR-5, `no-delete`). There is deliberately no remove/delete
 *    method — retraction is demotion + a ReviewEvent, never a destructive write. Absence
 *    is the enforcement.
 *  · **Scope filtering lives INSIDE the store** (§23). Every content read takes a
 *    `ReadScope`; callers never write a `where scope = …`, because one forgotten clause is
 *    a cross-tenant leak. A read at scope `tenant:x` sees that tenant's rows PLUS public;
 *    a read at `PUBLIC` sees only public.
 *
 * Every content-returning read takes a `TrustPolicy` with NO default (ADR-6): omitting it
 * fails to compile, forcing each call site to make the trust decision explicit.
 */
export interface KnowledgeStore {
  // ── writes (append-only; note the absence of any delete) ──
  putConcept(concept: Concept): Promise<void>;
  putConceptAlias(alias: ConceptAlias): Promise<void>;
  putConceptTag(tag: ConceptTag): Promise<void>;
  putStatement(statement: Statement): Promise<void>;
  putProvenance(provenance: Provenance): Promise<void>;
  putDependencyEdge(edge: DependencyEdge): Promise<void>;
  putCompositionEdge(edge: CompositionEdge): Promise<void>;
  putReinforcementEdge(edge: ReinforcementEdge): Promise<void>;
  putReviewEvent(event: ReviewEvent): Promise<void>;
  putRelease(release: Release, members: ReleaseMember[]): Promise<void>;
  /**
   * Idempotent by canonical hash (§14.2): identical dimension sets return the SAME row,
   * never a duplicate. The store owns id derivation so content-addressing can never drift.
   */
  putContext(dimensions: Record<string, unknown>): Promise<Context>;

  // ── scoped reads ──
  getConcept(id: string, scope: ReadScope): Promise<Concept | null>;
  resolveSlug(slug: string, scope: ReadScope): Promise<SlugResolution>;
  listConcepts(scope: ReadScope): Promise<Concept[]>;
  getContext(id: string): Promise<Context | null>;
  provenanceFor(statementId: string): Promise<Provenance[]>;
  reviewEventsFor(targetKind: string, targetId: string): Promise<ReviewEvent[]>;

  // ── content reads: scope-filtered AND trust-gated (labelled, never bare — §26.4/S3) ──
  getStatement(id: string, scope: ReadScope, policy: TrustPolicy): Promise<Labelled<Statement> | null>;
  statementsForSubject(subjectId: string, scope: ReadScope, policy: TrustPolicy): Promise<Labelled<Statement>[]>;

  // ── whole-graph reads (for graph invariants; edges carry no scope column, §10) ──
  dependencyEdges(): Promise<DependencyEdge[]>;
  compositionEdges(): Promise<CompositionEdge[]>;
  reinforcementEdges(): Promise<ReinforcementEdge[]>;
}
