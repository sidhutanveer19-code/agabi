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
  TrustPolicy,
  Labelled,
  SlugResolution,
  ReviewEffect,
  Program,
  ProgramNode,
  Mapping,
  ClosureCacheEntry,
  TeachingAsset,
  AssessmentItem,
  ItemConcept,
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
  /** The source a provenance row points at. Written BEFORE extraction so provenance never dangles. */
  putSource(source: Source): Promise<void>;
  /** The passage a statement was extracted from — what review shows and what V3 re-checks. */
  putSourceChunk(chunk: SourceChunk): Promise<void>;
  putDependencyEdge(edge: DependencyEdge): Promise<void>;
  putCompositionEdge(edge: CompositionEdge): Promise<void>;
  putReinforcementEdge(edge: ReinforcementEdge): Promise<void>;
  putReviewEvent(event: ReviewEvent): Promise<void>;
  putRelease(release: Release, members: ReleaseMember[]): Promise<void>;
  putTeachingAsset(asset: TeachingAsset): Promise<void>;
  putAssessmentItem(item: AssessmentItem): Promise<void>;
  putItemConcept(link: ItemConcept): Promise<void>;
  /**
   * Apply a review ATOMICALLY (§25, §27): append the ReviewEvent and persist its effect
   * (new trust level and/or dispute suspension) as one unit. This is the ONLY path that
   * writes trust above AUTO_VALIDATED — the store performs it, review/decide decides it.
   */
  commitReview(event: ReviewEvent, effect: ReviewEffect): Promise<void>;
  /**
   * Idempotent by canonical hash (§14.2): identical dimension sets return the SAME row,
   * never a duplicate. The store owns id derivation so content-addressing can never drift.
   */
  putContext(dimensions: Record<string, unknown>): Promise<Context>;
  // curriculum — a SEPARATE mapping layer (L7): knowledge never references it, so these are
  // additive and dropping them leaves the graph fully teachable (`curriculum-independence`).
  putProgram(program: Program): Promise<void>;
  putProgramNode(node: ProgramNode): Promise<void>;
  putMapping(mapping: Mapping): Promise<void>;
  // derived closure cache (ADR-11) — rebuildable, never authoritative; clear-all on any review commit (§18).
  putClosure(entry: ClosureCacheEntry): Promise<void>;
  clearClosures(): Promise<void>;

  // ── scoped reads ──
  getConcept(id: string, scope: ReadScope): Promise<Concept | null>;
  resolveSlug(slug: string, scope: ReadScope): Promise<SlugResolution>;
  /** Concepts reachable by a non-slug alias (SYNONYM/ABBREV/TRANSLATION/…) — search rung 2 (§15). */
  conceptsByAlias(alias: string, scope: ReadScope): Promise<Concept[]>;
  /** Fuzzy trigram match over name + aliases — search rung 3 (§15). Postgres needs the
   *  pg_trgm extension (gated, C4); the memory store computes trigrams in JS. */
  trigramConcepts(text: string, scope: ReadScope, threshold?: number): Promise<{ concept: Concept; score: number; matchedOn: string }[]>;
  listConcepts(scope: ReadScope): Promise<Concept[]>;
  mappingsForConcept(conceptId: string): Promise<Mapping[]>;
  mappingsUnderNode(programNodeId: string): Promise<Mapping[]>;
  getClosure(conceptId: string, releaseId: string): Promise<ClosureCacheEntry | null>;
  getContext(id: string): Promise<Context | null>;
  /** Unfiltered fetch for REVIEW — a disputed/low-trust statement is always visible to a
   *  reviewer (§26.5), so this bypasses scope/trust/dispute filtering. Never a learner path. */
  getStatementRaw(id: string): Promise<Statement | null>;
  provenanceFor(statementId: string): Promise<Provenance[]>;
  getSource(id: string): Promise<Source | null>;
  getSourceChunk(id: string): Promise<SourceChunk | null>;
  listSources(): Promise<Source[]>;
  chunksForSource(sourceId: string): Promise<SourceChunk[]>;
  /** Full-text search over source-chunk TEXT — search rung 4 (§15, amendment A-7). Postgres ranks
   *  via `websearch_to_tsquery` over a GIN expression index; the memory store scores term overlap in
   *  JS. This is a READ + PRESENT-ONLY path: it never writes the graph (A-7 invariant). */
  searchChunks(query: string, opts?: { limit?: number }): Promise<{ chunk: SourceChunk; score: number }[]>;
  reviewEventsFor(targetKind: string, targetId: string): Promise<ReviewEvent[]>;

  // ── content reads: scope-filtered AND trust-gated (labelled, never bare — §26.4/S3) ──
  getStatement(id: string, scope: ReadScope, policy: TrustPolicy): Promise<Labelled<Statement> | null>;
  statementsForSubject(subjectId: string, scope: ReadScope, policy: TrustPolicy): Promise<Labelled<Statement>[]>;
  /** Teaching assets for a concept — scope + trust gated (§13, §26.4). */
  assetsForConcept(conceptId: string, scope: ReadScope, policy: TrustPolicy): Promise<Labelled<TeachingAsset>[]>;
  /** Assessment items for a concept — scope + trust gated (§10, M9). */
  itemsForConcept(conceptId: string, scope: ReadScope, policy: TrustPolicy): Promise<Labelled<AssessmentItem>[]>;
  /** The members a release pinned — for point-in-time replay (§19). */
  releaseMembersOf(releaseId: string): Promise<ReleaseMember[]>;

  // ── whole-graph reads (for graph invariants; edges carry no scope column, §10) ──
  dependencyEdges(): Promise<DependencyEdge[]>;
  compositionEdges(): Promise<CompositionEdge[]>;
  reinforcementEdges(): Promise<ReinforcementEdge[]>;

  /**
   * The WHOLE graph, trust-unfiltered and scope-unfiltered, for export, restore and integrity
   * verification (never a learner path — the trust gate lives on the read methods above).
   *
   * Why a bulk read exists at all: the alternative — walking concepts and aggregating — silently
   * omits anything unreachable (a statement with no subject, an orphan asset), so an export built
   * that way would restore a *different* graph and an integrity check built that way could never
   * see the very rows it is meant to find. R1 applies to reads too: what you cannot enumerate,
   * you cannot report.
   *
   * Every array is sorted by id (edges by their composite key), so two dumps of the same state are
   * byte-identical — that determinism is what makes round-trip diffing possible.
   */
  dumpAll(): Promise<GraphDump>;
}

/** A complete, deterministic snapshot of every knowledge row. */
export interface GraphDump {
  concepts: Concept[];
  conceptAliases: ConceptAlias[];
  conceptTags: ConceptTag[];
  contexts: Context[];
  statements: Statement[];
  provenance: Provenance[];
  sources: Source[];
  sourceChunks: SourceChunk[];
  dependencyEdges: DependencyEdge[];
  compositionEdges: CompositionEdge[];
  reinforcementEdges: ReinforcementEdge[];
  reviewEvents: ReviewEvent[];
  teachingAssets: TeachingAsset[];
  assessmentItems: AssessmentItem[];
  itemConcepts: ItemConcept[];
  programs: Program[];
  programNodes: ProgramNode[];
  mappings: Mapping[];
  releases: Release[];
  releaseMembers: ReleaseMember[];
}
