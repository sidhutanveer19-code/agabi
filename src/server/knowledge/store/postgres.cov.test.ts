import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  Concept,
  Statement,
  Provenance,
  Source,
  SourceChunk,
  DependencyEdge,
  CompositionEdge,
  ReinforcementEdge,
  ReviewEvent,
  TeachingAsset,
  AssessmentItem,
  ItemConcept,
  ConceptAlias,
  ConceptTag,
  Program,
  ProgramNode,
  Release,
  ReleaseMember,
  Mapping,
  ClosureCacheEntry,
  ReviewEffect,
  TrustPolicy,
} from "@/server/knowledge/types";
import { contextId } from "@/server/knowledge/context/canonical";

/**
 * Unit coverage for the Postgres KnowledgeStore (`createPostgresStore`).
 *
 * The store is the ONE knowledge module that talks Prisma (wall W5). Everything it
 * does splits into two kinds of real logic worth pinning: (1) the WHERE/orderBy it
 * hands Prisma — scope filtering (§23), dispute suppression (§26.5), dedup, ordering,
 * the commitReview transaction shape — and (2) the row→domain mappers, whose every
 * `?? null` / `?? []` / `?? false` fallback is a branch.
 *
 * Per §H1.7 we fake ONLY the narrowest I/O edge — Prisma itself (a real DB is the
 * integration seam the conformance suite owns) — and keep every mapper, the trust
 * policy (`applyPolicy`), the canonical context hash (`contextId`) and the pure slug
 * resolver REAL. We capture the exact args passed to Prisma so a mutation to a scope
 * clause, an orderBy key, a dedup Set, or a commitReview branch goes red, and we feed
 * both a fully-populated row and a null/absent row through every mapper so both sides
 * of each fallback are exercised.
 */

const { mockPrisma } = vi.hoisted(() => {
  const model = () => ({
    create: vi.fn(),
    createMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  });
  return {
    mockPrisma: {
      concept: model(),
      conceptAlias: model(),
      conceptTag: model(),
      statement: model(),
      teachingAsset: model(),
      assessmentItem: model(),
      itemConcept: model(),
      provenance: model(),
      source: model(),
      sourceChunk: model(),
      dependencyEdge: model(),
      compositionEdge: model(),
      reinforcementEdge: model(),
      reviewEvent: model(),
      release: model(),
      releaseMember: model(),
      context: model(),
      program: model(),
      programNode: model(),
      mapping: model(),
      closureCache: model(),
      $transaction: vi.fn(),
      $queryRaw: vi.fn(),
    },
  };
});

vi.mock("@/server/db", () => ({ prisma: mockPrisma }));

const { createPostgresStore } = await import("@/server/knowledge/store/postgres");

// ── fixtures ───────────────────────────────────────────────────────────────
const t0 = new Date("2024-01-02T03:04:05.000Z");
const t1 = new Date("2024-06-07T08:09:10.000Z");
const scope = "tenant:x";
const scopeIn = { in: ["PUBLIC", "tenant:x"] };

const allModels = [
  mockPrisma.concept,
  mockPrisma.conceptAlias,
  mockPrisma.conceptTag,
  mockPrisma.statement,
  mockPrisma.teachingAsset,
  mockPrisma.assessmentItem,
  mockPrisma.itemConcept,
  mockPrisma.provenance,
  mockPrisma.source,
  mockPrisma.sourceChunk,
  mockPrisma.dependencyEdge,
  mockPrisma.compositionEdge,
  mockPrisma.reinforcementEdge,
  mockPrisma.reviewEvent,
  mockPrisma.release,
  mockPrisma.releaseMember,
  mockPrisma.context,
  mockPrisma.program,
  mockPrisma.programNode,
  mockPrisma.mapping,
  mockPrisma.closureCache,
];

beforeEach(() => {
  vi.resetAllMocks();
  for (const m of allModels) {
    m.findMany.mockResolvedValue([]);
    m.findFirst.mockResolvedValue(null);
    m.findUnique.mockResolvedValue(null);
    m.create.mockResolvedValue(undefined);
    m.createMany.mockResolvedValue(undefined);
    m.upsert.mockResolvedValue(undefined);
    m.update.mockResolvedValue(undefined);
    m.deleteMany.mockResolvedValue(undefined);
  }
  mockPrisma.$transaction.mockResolvedValue(undefined);
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

const store = () => createPostgresStore();

/** A fully-populated Concept row (every nullable set to a real value). */
const conceptRowFull = {
  id: "c1",
  slug: "algebra",
  name: "Algebra",
  kind: "SKILL",
  scope: "tenant:x",
  status: "ACTIVE",
  version: 3,
  supersedes: "c0",
  mergedInto: "cm",
  splitInto: ["s1", "s2"],
  createdAt: t0,
};
const conceptExpectedFull: Concept = {
  id: "c1",
  slug: "algebra",
  name: "Algebra",
  kind: "SKILL",
  scope: "tenant:x",
  status: "ACTIVE",
  version: 3,
  supersedes: "c0",
  mergedInto: "cm",
  splitInto: ["s1", "s2"],
  createdAt: t0,
};
/** The same shape with every nullable ABSENT (undefined) — hits the fallback side. */
const conceptRowMin = {
  id: "c2",
  slug: "geometry",
  name: "Geometry",
  kind: "ENTITY",
  scope: "PUBLIC",
  status: "DRAFT",
  version: 1,
  supersedes: undefined,
  mergedInto: undefined,
  splitInto: undefined,
  createdAt: t1,
};

// A reusable full statement row; overrides tune trust/dispute/scope per test.
function stmtRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "s1",
    kind: "FACT",
    form: "SPO",
    structure: { s: 1 },
    subjectId: "subj",
    predicate: "pred",
    objectId: "obj",
    objectLit: "lit",
    text: "the text",
    payload: { p: 2 },
    contextId: "ctx1",
    scope: "PUBLIC",
    trustLevel: "AUTO_VALIDATED",
    validationMethods: ["V1"],
    corroborationCount: 3,
    independentSourceCount: 2,
    derivedFrom: ["d1"],
    authority: "auth",
    evidenceLevel: "HIGH",
    version: 4,
    supersedes: "s0",
    createdAt: t0,
    disputed: false,
    disputeReason: null,
    disputedAt: null,
    priorTrustLevel: null,
    ...over,
  };
}

// ── writes: upserts vs creates, and the exact data mapping ───────────────────
describe("writes — the exact Prisma call each performs", () => {
  it("putConcept upserts by immutable id (create AND update carry the row — last-write-wins, no delete)", async () => {
    const c = conceptExpectedFull;
    await store().putConcept(c);
    expect(mockPrisma.concept.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.concept.upsert).toHaveBeenCalledWith({ where: { id: "c1" }, create: c, update: c });
  });

  it("putSource upserts (content-addressed → re-ingest is idempotent, not a crash)", async () => {
    const src: Source = {
      id: "src1", kind: "BOOK", title: "T", publisher: "P", authority: "A",
      edition: null, publishedAt: null, uri: null, checksum: "abc", license: "CC",
      licenseUrl: null, ingestedAt: t0,
    };
    await store().putSource(src);
    expect(mockPrisma.source.upsert).toHaveBeenCalledWith({ where: { id: "src1" }, create: src, update: src });
  });

  it("putSourceChunk upserts with locator carried into BOTH create and update", async () => {
    const chunk: SourceChunk = { id: "ch1", sourceId: "src1", locator: { page: 1, range: [2, 5] }, text: "x", ordinal: 0 };
    await store().putSourceChunk(chunk);
    expect(mockPrisma.sourceChunk.upsert).toHaveBeenCalledWith({
      where: { id: "ch1" },
      create: { ...chunk, locator: chunk.locator },
      update: { ...chunk, locator: chunk.locator },
    });
  });

  it("putStatement creates with structure+payload passed through as objects", async () => {
    const s = JSON.parse(JSON.stringify(stmtRow())) as Statement;
    await store().putStatement(s);
    expect(mockPrisma.statement.create).toHaveBeenCalledWith({
      data: { ...s, structure: s.structure, payload: s.payload },
    });
  });

  it("putProvenance creates with locator carried through", async () => {
    const p: Provenance = {
      statementId: "s1", sourceId: "src1", chunkId: "ch1", locator: { page: 3 },
      quote: "q", extractorVersion: "e1", promptVersion: "p1", modelId: "m1", extractedAt: t0,
    };
    await store().putProvenance(p);
    expect(mockPrisma.provenance.create).toHaveBeenCalledWith({ data: { ...p, locator: p.locator } });
  });

  it("putTeachingAsset / putAssessmentItem create with payload carried through", async () => {
    const asset: TeachingAsset = {
      id: "a1", kind: "ANALOGY", conceptId: "c1", statementId: null, payload: { breakdownPoint: "x" },
      contextId: "ctx1", trustLevel: "AUTO_VALIDATED", scope: "PUBLIC", version: 1, supersedes: null,
    };
    const item: AssessmentItem = {
      id: "i1", kind: "MCQ", prompt: "?", payload: { a: 1 }, contextId: "ctx1",
      scope: "PUBLIC", trustLevel: "AUTO_VALIDATED", version: 1, supersedes: null,
    };
    await store().putTeachingAsset(asset);
    await store().putAssessmentItem(item);
    expect(mockPrisma.teachingAsset.create).toHaveBeenCalledWith({ data: { ...asset, payload: asset.payload } });
    expect(mockPrisma.assessmentItem.create).toHaveBeenCalledWith({ data: { ...item, payload: item.payload } });
  });

  it("putReviewEvent creates with before+after carried through", async () => {
    const r: ReviewEvent = {
      id: "r1", targetKind: "Statement", targetId: "s1", decision: "APPROVE",
      fromTrust: null, toTrust: "COMMUNITY_REVIEWED", actorId: "u1", before: { a: 1 }, after: { a: 2 },
      reason: null, batchId: null, createdAt: t0,
    };
    await store().putReviewEvent(r);
    expect(mockPrisma.reviewEvent.create).toHaveBeenCalledWith({ data: { ...r, before: r.before, after: r.after } });
  });

  it("simple creates (alias/tag/itemConcept/edges/program/programNode/mapping) pass the row straight through", async () => {
    const s = store();
    const alias: ConceptAlias = { conceptId: "c1", alias: "maths", language: "en", kind: "SYNONYM" };
    const tag: ConceptTag = { conceptId: "c1", namespace: "cbse", value: "algebra" };
    const link: ItemConcept = { itemId: "i1", conceptId: "c1", role: "PRIMARY", bloom: "APPLY" };
    const dep: DependencyEdge = { fromId: "a", toId: "b", strength: 0.5, contextId: null, version: 1, supersedes: null };
    const comp: CompositionEdge = { partId: "p", wholeId: "w", ordinal: 1, version: 1 };
    const rein: ReinforcementEdge = { fromId: "a", toId: "b", type: "REINFORCES", strength: 0.3, earned: true, contextId: null, version: 1 };
    const prog: Program = { id: "pg1", slug: "cbse", name: "CBSE", kind: "SCHOOL_BOARD", authority: "NCERT", jurisdiction: "IN", scope: "PUBLIC", version: "2024" };
    const node: ProgramNode = { id: "n1", programId: "pg1", parentId: null, nodeKind: "TOPIC", name: "Algebra", ordinal: 1, code: "1.1" };
    const map: Mapping = { programNodeId: "n1", conceptId: "c1", depth: "DEVELOP", ordinal: 1, examWeight: 5, required: true };

    await s.putConceptAlias(alias);
    await s.putConceptTag(tag);
    await s.putItemConcept(link);
    await s.putDependencyEdge(dep);
    await s.putCompositionEdge(comp);
    await s.putReinforcementEdge(rein);
    await s.putProgram(prog);
    await s.putProgramNode(node);
    await s.putMapping(map);

    expect(mockPrisma.conceptAlias.create).toHaveBeenCalledWith({ data: alias });
    expect(mockPrisma.conceptTag.create).toHaveBeenCalledWith({ data: tag });
    expect(mockPrisma.itemConcept.create).toHaveBeenCalledWith({ data: link });
    expect(mockPrisma.dependencyEdge.create).toHaveBeenCalledWith({ data: dep });
    expect(mockPrisma.compositionEdge.create).toHaveBeenCalledWith({ data: comp });
    expect(mockPrisma.reinforcementEdge.create).toHaveBeenCalledWith({ data: rein });
    expect(mockPrisma.program.create).toHaveBeenCalledWith({ data: prog });
    expect(mockPrisma.programNode.create).toHaveBeenCalledWith({ data: node });
    expect(mockPrisma.mapping.create).toHaveBeenCalledWith({ data: map });
  });

  it("putRelease commits the release row and its members as ONE transaction of two ops", async () => {
    const release: Release = { id: "2024-01-01-01", label: "R1", createdAt: t0, frozen: false };
    const members: ReleaseMember[] = [
      { releaseId: "2024-01-01-01", kind: "Concept", entityId: "c1" },
      { releaseId: "2024-01-01-01", kind: "Statement", entityId: "s1" },
    ];
    await store().putRelease(release, members);
    expect(mockPrisma.release.create).toHaveBeenCalledWith({ data: release });
    expect(mockPrisma.releaseMember.createMany).toHaveBeenCalledWith({ data: members });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("putClosure upserts by composite key; create carries the full entry, update only closure+computedAt", async () => {
    const entry: ClosureCacheEntry = { conceptId: "c1", releaseId: "r1", closure: ["p1", "p2"], computedAt: t0 };
    await store().putClosure(entry);
    expect(mockPrisma.closureCache.upsert).toHaveBeenCalledWith({
      where: { conceptId_releaseId: { conceptId: "c1", releaseId: "r1" } },
      create: { ...entry, closure: entry.closure },
      update: { closure: entry.closure, computedAt: t0 },
    });
  });

  it("clearClosures deletes the whole derived cache (deleteMany with empty filter)", async () => {
    await store().clearClosures();
    expect(mockPrisma.closureCache.deleteMany).toHaveBeenCalledWith({});
  });
});

// ── putContext — canonical hash is REAL and drives idempotency ───────────────
describe("putContext / getContext", () => {
  it("upserts under the REAL canonical id and returns the mapped row (idempotent by content)", async () => {
    const dims = { grade: "10", board: "CBSE" };
    const id = contextId(dims); // real hash — same dims must map to same row
    mockPrisma.context.upsert.mockResolvedValue({ id, dimensions: dims });

    const out = await store().putContext(dims);

    expect(mockPrisma.context.upsert).toHaveBeenCalledWith({
      where: { id },
      create: { id, dimensions: dims },
      update: {},
    });
    expect(out).toEqual({ id, dimensions: dims });
  });

  it("two dimension sets that differ only in key order hash to the SAME id (canonical, not literal)", async () => {
    mockPrisma.context.upsert.mockResolvedValue({ id: "z", dimensions: {} });
    const s = store();
    await s.putContext({ a: 1, b: 2 });
    await s.putContext({ b: 2, a: 1 });
    const idA = (mockPrisma.context.upsert.mock.calls[0][0] as { where: { id: string } }).where.id;
    const idB = (mockPrisma.context.upsert.mock.calls[1][0] as { where: { id: string } }).where.id;
    expect(idA).toBe(idB);
  });

  it("getContext maps a present row and returns null when absent", async () => {
    mockPrisma.context.findUnique.mockResolvedValueOnce({ id: "ctx1", dimensions: { g: "10" } });
    expect(await store().getContext("ctx1")).toEqual({ id: "ctx1", dimensions: { g: "10" } });
    expect(mockPrisma.context.findUnique).toHaveBeenCalledWith({ where: { id: "ctx1" } });

    mockPrisma.context.findUnique.mockResolvedValueOnce(null);
    expect(await store().getContext("missing")).toBeNull();
  });
});

// ── commitReview — the atomic event+effect transaction, every branch ─────────
describe("commitReview — atomic event + effect", () => {
  const baseEvent: ReviewEvent = {
    id: "r1", targetKind: "Statement", targetId: "s1", decision: "PROMOTE",
    fromTrust: "AUTO_VALIDATED", toTrust: "EXPERT_REVIEWED", actorId: "u1",
    before: { b: 1 }, after: { a: 1 }, reason: "ok", batchId: null, createdAt: t0,
  };

  it("always appends the ReviewEvent (before/after carried); non-Statement target → ONE op, no statement.update", async () => {
    const effect: ReviewEffect = { targetKind: "Concept", targetId: "c1", trustLevel: "EXPERT_REVIEWED" };
    await store().commitReview(baseEvent, effect);
    expect(mockPrisma.reviewEvent.create).toHaveBeenCalledWith({
      data: { ...baseEvent, before: baseEvent.before, after: baseEvent.after },
    });
    expect(mockPrisma.statement.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it("Statement target but NO trustLevel and NO dispute → still ONE op (the && short-circuits)", async () => {
    const effect: ReviewEffect = { targetKind: "Statement", targetId: "s1" };
    await store().commitReview(baseEvent, effect);
    expect(mockPrisma.statement.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it("trustLevel only → updates trustLevel and NOTHING else", async () => {
    const effect: ReviewEffect = { targetKind: "Statement", targetId: "s1", trustLevel: "EXPERT_REVIEWED" };
    await store().commitReview(baseEvent, effect);
    expect(mockPrisma.statement.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { trustLevel: "EXPERT_REVIEWED" },
    });
    expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("dispute only → writes the four dispute columns, no trustLevel", async () => {
    const effect: ReviewEffect = {
      targetKind: "Statement", targetId: "s1",
      dispute: { disputed: true, reason: "conflict", priorTrustLevel: "AUTO_VALIDATED", at: t1 },
    };
    await store().commitReview(baseEvent, effect);
    expect(mockPrisma.statement.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { disputed: true, disputeReason: "conflict", priorTrustLevel: "AUTO_VALIDATED", disputedAt: t1 },
    });
  });

  it("trustLevel AND dispute together → both merged into one update", async () => {
    const effect: ReviewEffect = {
      targetKind: "Statement", targetId: "s1", trustLevel: "OFFICIAL_SOURCE_VERIFIED",
      dispute: { disputed: false, reason: null, priorTrustLevel: null, at: null },
    };
    await store().commitReview(baseEvent, effect);
    expect(mockPrisma.statement.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: {
        trustLevel: "OFFICIAL_SOURCE_VERIFIED",
        disputed: false, disputeReason: null, priorTrustLevel: null, disputedAt: null,
      },
    });
    expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });
});

// ── scoped reads: WHERE filtering + null vs present ──────────────────────────
describe("getConcept — scope filter and toConcept mapping (both fallback sides)", () => {
  it("filters to own-tenant OR public, and maps every populated column", async () => {
    mockPrisma.concept.findFirst.mockResolvedValueOnce(conceptRowFull);
    const c = await store().getConcept("c1", scope);
    expect(mockPrisma.concept.findFirst).toHaveBeenCalledWith({ where: { id: "c1", scope: scopeIn } });
    expect(c).toEqual(conceptExpectedFull);
  });

  it("maps absent supersedes/mergedInto → null and absent splitInto → [] (fallback side)", async () => {
    mockPrisma.concept.findFirst.mockResolvedValueOnce(conceptRowMin);
    const c = await store().getConcept("c2", "PUBLIC");
    expect(c?.supersedes).toBeNull();
    expect(c?.mergedInto).toBeNull();
    expect(c?.splitInto).toEqual([]);
    expect(mockPrisma.concept.findFirst).toHaveBeenCalledWith({ where: { id: "c2", scope: { in: ["PUBLIC", "PUBLIC"] } } });
  });

  it("returns null when no row matches", async () => {
    mockPrisma.concept.findFirst.mockResolvedValueOnce(null);
    expect(await store().getConcept("nope", scope)).toBeNull();
  });
});

describe("listConcepts / conceptsByAlias", () => {
  it("listConcepts filters by scope and maps every row", async () => {
    mockPrisma.concept.findMany.mockResolvedValueOnce([conceptRowFull, conceptRowMin]);
    const out = await store().listConcepts(scope);
    expect(mockPrisma.concept.findMany).toHaveBeenCalledWith({ where: { scope: scopeIn } });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(conceptExpectedFull);
  });

  it("conceptsByAlias DEDUPES the concept ids before the scoped lookup", async () => {
    mockPrisma.conceptAlias.findMany.mockResolvedValueOnce([
      { conceptId: "c1" }, { conceptId: "c1" }, { conceptId: "c2" },
    ]);
    mockPrisma.concept.findMany.mockResolvedValueOnce([conceptRowFull]);
    const out = await store().conceptsByAlias("maths", scope);
    expect(mockPrisma.conceptAlias.findMany).toHaveBeenCalledWith({ where: { alias: "maths" } });
    expect(mockPrisma.concept.findMany).toHaveBeenCalledWith({ where: { id: { in: ["c1", "c2"] }, scope: scopeIn } });
    expect(out).toEqual([conceptExpectedFull]);
  });

  it("conceptsByAlias returns [] when no alias rows exist", async () => {
    mockPrisma.conceptAlias.findMany.mockResolvedValueOnce([]);
    const out = await store().conceptsByAlias("nothing", scope);
    expect(mockPrisma.concept.findMany).toHaveBeenCalledWith({ where: { id: { in: [] }, scope: scopeIn } });
    expect(out).toEqual([]);
  });
});

// ── resolveSlug — the pure resolver is REAL; the store wires scope+aliases ────
describe("resolveSlug — real tombstone-following over scoped snapshot", () => {
  const cAlgebra = { id: "c1", slug: "algebra", name: "Algebra", kind: "SKILL", scope: "PUBLIC", status: "ACTIVE", version: 1, supersedes: null, mergedInto: null, splitInto: [], createdAt: t0 };
  const cLoser = { id: "loser", slug: "loser-slug", name: "L", kind: "ENTITY", scope: "PUBLIC", status: "MERGED", version: 1, supersedes: null, mergedInto: "winner", splitInto: [], createdAt: t0 };
  const cWinner = { id: "winner", slug: "winner-slug", name: "W", kind: "ENTITY", scope: "PUBLIC", status: "ACTIVE", version: 1, supersedes: null, mergedInto: null, splitInto: [], createdAt: t0 };
  const cSplit = { id: "src", slug: "split-slug", name: "S", kind: "ENTITY", scope: "PUBLIC", status: "SPLIT", version: 1, supersedes: null, mergedInto: null, splitInto: ["a", "b"], createdAt: t0 };
  const aliases = [
    { conceptId: "c1", alias: "old-algebra", language: "en", kind: "FORMER_NAME" },
    { conceptId: "ghostC", alias: "ghost", language: "en", kind: "FORMER_NAME" },
  ];

  beforeEach(() => {
    mockPrisma.concept.findMany.mockResolvedValue([cAlgebra, cLoser, cWinner, cSplit]);
    mockPrisma.conceptAlias.findMany.mockResolvedValue(aliases);
  });

  it("snapshots visible concepts by scope and FORMER_NAME aliases only", async () => {
    await store().resolveSlug("algebra", scope);
    expect(mockPrisma.concept.findMany).toHaveBeenCalledWith({ where: { scope: scopeIn } });
    expect(mockPrisma.conceptAlias.findMany).toHaveBeenCalledWith({ where: { kind: "FORMER_NAME" } });
  });

  it("resolves a live slug directly (bySlug)", async () => {
    expect(await store().resolveSlug("algebra", scope)).toEqual({ kind: "concept", conceptId: "c1" });
  });

  it("resolves a FORMER_NAME alias whose concept is visible (formerName → byId)", async () => {
    expect(await store().resolveSlug("old-algebra", scope)).toEqual({ kind: "concept", conceptId: "c1" });
  });

  it("follows a merge tombstone to the winner (byId chain)", async () => {
    expect(await store().resolveSlug("loser-slug", scope)).toEqual({ kind: "concept", conceptId: "winner" });
  });

  it("reports a split concept as honestly ambiguous", async () => {
    expect(await store().resolveSlug("split-slug", scope)).toEqual({ kind: "ambiguous", candidates: ["a", "b"] });
  });

  it("a FORMER_NAME alias pointing at an INVISIBLE concept resolves to none (byId.has false)", async () => {
    expect(await store().resolveSlug("ghost", scope)).toEqual({ kind: "none" });
  });

  it("an unknown slug resolves to none", async () => {
    expect(await store().resolveSlug("does-not-exist", scope)).toEqual({ kind: "none" });
  });
});

// ── trigramConcepts — JS-side scope filter + score mapping over raw SQL ───────
describe("trigramConcepts", () => {
  function trigRow(over: Record<string, unknown>) {
    return { ...conceptRowFull, ...over };
  }

  it("keeps PUBLIC and own-tenant rows, drops other tenants, and maps score/matchedOn", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      trigRow({ id: "p", scope: "PUBLIC", name: "Algebra", _score: 0.9 }),
      trigRow({ id: "own", scope: "tenant:x", name: "Alg", _score: 0.6 }),
      trigRow({ id: "other", scope: "tenant:y", name: "Other", _score: 0.5 }),
    ]);
    const out = await store().trigramConcepts("alg", scope);
    expect(out.map((r) => r.concept.id)).toEqual(["p", "own"]);
    expect(out[0]).toMatchObject({ score: 0.9, matchedOn: "name:Algebra" });
    expect(out[1]).toMatchObject({ score: 0.6, matchedOn: "name:Alg" });
  });

  it("coerces a string _score into a number (Number(...))", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([trigRow({ scope: "PUBLIC", _score: "0.75" })]);
    const out = await store().trigramConcepts("alg", scope);
    expect(out[0].score).toBe(0.75);
    expect(typeof out[0].score).toBe("number");
  });

  it("passes the search text and DEFAULT threshold 0.3 into the query", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    await store().trigramConcepts("pythagoras", scope);
    const sql = mockPrisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values[0]).toBe("pythagoras");
    expect(sql.values[2]).toBe(0.3);
  });

  it("uses an explicit threshold when supplied", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    await store().trigramConcepts("x", scope, 0.7);
    const sql = mockPrisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values[2]).toBe(0.7);
  });
});

// ── searchChunks — tokenisation, OR-recall, empty guard, limit ───────────────
describe("searchChunks", () => {
  const chunkRow = { id: "ch1", sourceId: "src1", locator: { page: 1, range: [0, 9] }, text: "primes", ordinal: 2, _score: 0.42 };

  it("returns [] WITHOUT touching the DB when the query has no alphanumeric tokens", async () => {
    const out = await store().searchChunks("!!!  ---");
    expect(out).toEqual([]);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("lowercases + tokenises to [a-z0-9]+ and OR-joins the terms into a tsquery", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([chunkRow]);
    const out = await store().searchChunks("Prime Factors!");
    const sql = mockPrisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values[0]).toBe("prime | factors");
    expect(out).toEqual([{ chunk: { id: "ch1", sourceId: "src1", locator: { page: 1, range: [0, 9] }, text: "primes", ordinal: 2 }, score: 0.42 }]);
  });

  it("defaults the limit to 8 and honours an explicit limit", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await store().searchChunks("prime");
    const first = mockPrisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(first.values[2]).toBe(8);

    await store().searchChunks("prime", { limit: 3 });
    const second = mockPrisma.$queryRaw.mock.calls[1][0] as { values: unknown[] };
    expect(second.values[2]).toBe(3);
  });

  it("coerces a string _score to a number", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ ...chunkRow, _score: "0.5" }]);
    const out = await store().searchChunks("prime");
    expect(out[0].score).toBe(0.5);
  });
});

// ── content reads: scope in SQL, trust applied read-time (applyPolicy REAL) ───
describe("getStatement — scope + disputed:false in SQL, trust policy real", () => {
  const policy: TrustPolicy = { minimum: "COMMUNITY_REVIEWED", labelBelow: "EXPERT_REVIEWED", refuseBelow: "AUTO_VALIDATED" };

  it("queries with scope AND disputed:false, and returns a PLAIN (unlabelled) high-trust row", async () => {
    mockPrisma.statement.findFirst.mockResolvedValueOnce(stmtRow({ id: "s1", trustLevel: "EXPERT_REVIEWED" }));
    const out = await store().getStatement("s1", scope, policy);
    expect(mockPrisma.statement.findFirst).toHaveBeenCalledWith({ where: { id: "s1", scope: scopeIn, disputed: false } });
    expect(out?.labelled).toBe(false);
    expect(out?.id).toBe("s1");
  });

  it("labels a row between refuseBelow and labelBelow", async () => {
    mockPrisma.statement.findFirst.mockResolvedValueOnce(stmtRow({ trustLevel: "COMMUNITY_REVIEWED" }));
    const out = await store().getStatement("s1", scope, policy);
    expect(out?.labelled).toBe(true);
  });

  it("REFUSES a below-floor row → null (applyPolicy drops it, then `?? null`)", async () => {
    mockPrisma.statement.findFirst.mockResolvedValueOnce(stmtRow({ trustLevel: "MACHINE_PROPOSED" }));
    expect(await store().getStatement("s1", scope, policy)).toBeNull();
  });

  it("returns null when the row itself is missing", async () => {
    mockPrisma.statement.findFirst.mockResolvedValueOnce(null);
    expect(await store().getStatement("s1", scope, policy)).toBeNull();
  });
});

describe("statementsForSubject / assetsForConcept / itemsForConcept", () => {
  const policy: TrustPolicy = { minimum: "COMMUNITY_REVIEWED", labelBelow: "EXPERT_REVIEWED", refuseBelow: "AUTO_VALIDATED" };

  it("statementsForSubject filters scope+disputed, drops refused, labels the rest, preserves order", async () => {
    mockPrisma.statement.findMany.mockResolvedValueOnce([
      stmtRow({ id: "hi", trustLevel: "EXPERT_REVIEWED" }),
      stmtRow({ id: "lo", trustLevel: "MACHINE_PROPOSED" }),
      stmtRow({ id: "mid", trustLevel: "COMMUNITY_REVIEWED" }),
    ]);
    const out = await store().statementsForSubject("subj", scope, policy);
    expect(mockPrisma.statement.findMany).toHaveBeenCalledWith({ where: { subjectId: "subj", scope: scopeIn, disputed: false } });
    expect(out.map((r) => [r.id, r.labelled])).toEqual([["hi", false], ["mid", true]]);
  });

  it("assetsForConcept filters by scope (no disputed column) and applies policy", async () => {
    mockPrisma.teachingAsset.findMany.mockResolvedValueOnce([
      { id: "a1", kind: "ANALOGY", conceptId: "c1", statementId: "s1", payload: {}, contextId: "ctx", trustLevel: "EXPERT_REVIEWED", scope: "PUBLIC", version: 1, supersedes: "a0" },
      { id: "a2", kind: "ANALOGY", conceptId: "c1", statementId: undefined, payload: {}, contextId: "ctx", trustLevel: "MACHINE_PROPOSED", scope: "PUBLIC", version: 1, supersedes: undefined },
    ]);
    const out = await store().assetsForConcept("c1", scope, policy);
    expect(mockPrisma.teachingAsset.findMany).toHaveBeenCalledWith({ where: { conceptId: "c1", scope: scopeIn } });
    expect(out.map((r) => r.id)).toEqual(["a1"]); // a2 refused
    expect(out[0].statementId).toBe("s1");
    expect(out[0].labelled).toBe(false);
  });

  it("itemsForConcept dedupes item ids from links, then scope-filters and applies policy", async () => {
    mockPrisma.itemConcept.findMany.mockResolvedValueOnce([{ itemId: "i1" }, { itemId: "i1" }, { itemId: "i2" }]);
    mockPrisma.assessmentItem.findMany.mockResolvedValueOnce([
      { id: "i1", kind: "MCQ", prompt: "?", payload: {}, contextId: "ctx", scope: "PUBLIC", trustLevel: "EXPERT_REVIEWED", version: 1, supersedes: null },
    ]);
    const out = await store().itemsForConcept("c1", scope, policy);
    expect(mockPrisma.itemConcept.findMany).toHaveBeenCalledWith({ where: { conceptId: "c1" } });
    expect(mockPrisma.assessmentItem.findMany).toHaveBeenCalledWith({ where: { id: { in: ["i1", "i2"] }, scope: scopeIn } });
    expect(out.map((r) => r.id)).toEqual(["i1"]);
    expect(out[0].supersedes).toBeNull();
  });
});

// ── unfiltered reads + their mappers (full vs null) ──────────────────────────
describe("getStatementRaw — bypasses scope/trust; toStatement both fallback sides", () => {
  it("maps a fully-populated row (arrays, dispute flags, all present)", async () => {
    mockPrisma.statement.findUnique.mockResolvedValueOnce(stmtRow({
      trustLevel: "EXPERT_REVIEWED", disputed: true, disputeReason: "bad", disputedAt: t1, priorTrustLevel: "AUTO_VALIDATED",
    }));
    const s = await store().getStatementRaw("s1");
    expect(mockPrisma.statement.findUnique).toHaveBeenCalledWith({ where: { id: "s1" } });
    expect(s).toEqual({
      id: "s1", kind: "FACT", form: "SPO", structure: { s: 1 }, subjectId: "subj", predicate: "pred",
      objectId: "obj", objectLit: "lit", text: "the text", payload: { p: 2 }, contextId: "ctx1", scope: "PUBLIC",
      trustLevel: "EXPERT_REVIEWED", validationMethods: ["V1"], corroborationCount: 3, independentSourceCount: 2,
      derivedFrom: ["d1"], authority: "auth", evidenceLevel: "HIGH", version: 4, supersedes: "s0", createdAt: t0,
      disputed: true, disputeReason: "bad", disputedAt: t1, priorTrustLevel: "AUTO_VALIDATED",
    });
  });

  it("maps every absent nullable to its fallback (null / [] / false)", async () => {
    mockPrisma.statement.findUnique.mockResolvedValueOnce({
      id: "s2", kind: "DEF", form: "DEFINITIONAL", structure: {}, subjectId: undefined, predicate: undefined,
      objectId: undefined, objectLit: undefined, text: "", payload: {}, contextId: "ctx2", scope: "PUBLIC",
      trustLevel: "MACHINE_PROPOSED", validationMethods: undefined, corroborationCount: 0, independentSourceCount: 0,
      derivedFrom: undefined, authority: undefined, evidenceLevel: undefined, version: 1, supersedes: undefined,
      createdAt: t0, disputed: undefined, disputeReason: undefined, disputedAt: undefined, priorTrustLevel: undefined,
    });
    const s = await store().getStatementRaw("s2");
    expect(s?.subjectId).toBeNull();
    expect(s?.predicate).toBeNull();
    expect(s?.objectId).toBeNull();
    expect(s?.objectLit).toBeNull();
    expect(s?.authority).toBeNull();
    expect(s?.evidenceLevel).toBeNull();
    expect(s?.supersedes).toBeNull();
    expect(s?.disputeReason).toBeNull();
    expect(s?.disputedAt).toBeNull();
    expect(s?.priorTrustLevel).toBeNull();
    expect(s?.validationMethods).toEqual([]);
    expect(s?.derivedFrom).toEqual([]);
    expect(s?.disputed).toBe(false);
  });

  it("returns null when absent", async () => {
    mockPrisma.statement.findUnique.mockResolvedValueOnce(null);
    expect(await store().getStatementRaw("x")).toBeNull();
  });
});

describe("provenanceFor / getSource / listSources — mappers", () => {
  it("provenanceFor maps rows straight (locator passthrough)", async () => {
    mockPrisma.provenance.findMany.mockResolvedValueOnce([
      { statementId: "s1", sourceId: "src1", chunkId: "ch1", locator: { page: 3 }, quote: "q", extractorVersion: "e", promptVersion: "p", modelId: "m", extractedAt: t0 },
    ]);
    const out = await store().provenanceFor("s1");
    expect(mockPrisma.provenance.findMany).toHaveBeenCalledWith({ where: { statementId: "s1" } });
    expect(out[0]).toEqual({ statementId: "s1", sourceId: "src1", chunkId: "ch1", locator: { page: 3 }, quote: "q", extractorVersion: "e", promptVersion: "p", modelId: "m", extractedAt: t0 });
  });

  it("getSource maps a full row and, separately, all null fallbacks", async () => {
    mockPrisma.source.findUnique.mockResolvedValueOnce({
      id: "src1", kind: "BOOK", title: "T", publisher: "P", authority: "A", edition: "1st",
      publishedAt: t1, uri: "http://x", checksum: "sum", license: "CC", licenseUrl: "http://l", ingestedAt: t0,
    });
    const full = await store().getSource("src1");
    expect(full).toEqual({ id: "src1", kind: "BOOK", title: "T", publisher: "P", authority: "A", edition: "1st", publishedAt: t1, uri: "http://x", checksum: "sum", license: "CC", licenseUrl: "http://l", ingestedAt: t0 });

    mockPrisma.source.findUnique.mockResolvedValueOnce({
      id: "src2", kind: "WEB", title: "T2", publisher: "P2", authority: "A2", edition: undefined,
      publishedAt: undefined, uri: undefined, checksum: "s2", license: "MIT", licenseUrl: undefined, ingestedAt: t0,
    });
    const min = await store().getSource("src2");
    expect(min?.edition).toBeNull();
    expect(min?.publishedAt).toBeNull();
    expect(min?.uri).toBeNull();
    expect(min?.licenseUrl).toBeNull();
  });

  it("getSource returns null when absent", async () => {
    mockPrisma.source.findUnique.mockResolvedValueOnce(null);
    expect(await store().getSource("x")).toBeNull();
  });

  it("listSources orders by id asc and maps", async () => {
    mockPrisma.source.findMany.mockResolvedValueOnce([{ id: "src1", kind: "BOOK", title: "T", publisher: "P", authority: "A", edition: null, publishedAt: null, uri: null, checksum: "c", license: "CC", licenseUrl: null, ingestedAt: t0 }]);
    const out = await store().listSources();
    expect(mockPrisma.source.findMany).toHaveBeenCalledWith({ orderBy: { id: "asc" } });
    expect(out).toHaveLength(1);
  });
});

describe("getSourceChunk / chunksForSource", () => {
  const row = { id: "ch1", sourceId: "src1", locator: { page: 1, range: [2, 5] }, text: "passage", ordinal: 4 };
  it("getSourceChunk maps present + returns null absent", async () => {
    mockPrisma.sourceChunk.findUnique.mockResolvedValueOnce(row);
    expect(await store().getSourceChunk("ch1")).toEqual({ id: "ch1", sourceId: "src1", locator: { page: 1, range: [2, 5] }, text: "passage", ordinal: 4 });
    mockPrisma.sourceChunk.findUnique.mockResolvedValueOnce(null);
    expect(await store().getSourceChunk("x")).toBeNull();
  });

  it("chunksForSource filters by sourceId ordered by ordinal asc", async () => {
    mockPrisma.sourceChunk.findMany.mockResolvedValueOnce([row]);
    const out = await store().chunksForSource("src1");
    expect(mockPrisma.sourceChunk.findMany).toHaveBeenCalledWith({ where: { sourceId: "src1" }, orderBy: { ordinal: "asc" } });
    expect(out).toHaveLength(1);
  });
});

describe("reviewEventsFor — toReviewEvent both fallback sides", () => {
  it("filters by target and maps a full row", async () => {
    mockPrisma.reviewEvent.findMany.mockResolvedValueOnce([
      { id: "r1", targetKind: "Statement", targetId: "s1", decision: "APPROVE", fromTrust: "AUTO_VALIDATED", toTrust: "EXPERT_REVIEWED", actorId: "u1", before: { b: 1 }, after: { a: 1 }, reason: "why", batchId: "batch1", createdAt: t0 },
    ]);
    const out = await store().reviewEventsFor("Statement", "s1");
    expect(mockPrisma.reviewEvent.findMany).toHaveBeenCalledWith({ where: { targetKind: "Statement", targetId: "s1" } });
    expect(out[0]).toEqual({ id: "r1", targetKind: "Statement", targetId: "s1", decision: "APPROVE", fromTrust: "AUTO_VALIDATED", toTrust: "EXPERT_REVIEWED", actorId: "u1", before: { b: 1 }, after: { a: 1 }, reason: "why", batchId: "batch1", createdAt: t0 });
  });

  it("maps absent fromTrust/toTrust/reason/batchId to null", async () => {
    mockPrisma.reviewEvent.findMany.mockResolvedValueOnce([
      { id: "r2", targetKind: "Concept", targetId: "c1", decision: "EDIT", fromTrust: undefined, toTrust: undefined, actorId: "u1", before: null, after: null, reason: undefined, batchId: undefined, createdAt: t0 },
    ]);
    const out = await store().reviewEventsFor("Concept", "c1");
    expect(out[0].fromTrust).toBeNull();
    expect(out[0].toTrust).toBeNull();
    expect(out[0].reason).toBeNull();
    expect(out[0].batchId).toBeNull();
  });
});

// ── closures + release members ───────────────────────────────────────────────
describe("getClosure / releaseMembersOf", () => {
  it("getClosure maps a present entry by composite key and returns null when absent", async () => {
    mockPrisma.closureCache.findUnique.mockResolvedValueOnce({ conceptId: "c1", releaseId: "r1", closure: ["p1", "p2"], computedAt: t0 });
    const hit = await store().getClosure("c1", "r1");
    expect(mockPrisma.closureCache.findUnique).toHaveBeenCalledWith({ where: { conceptId_releaseId: { conceptId: "c1", releaseId: "r1" } } });
    expect(hit).toEqual({ conceptId: "c1", releaseId: "r1", closure: ["p1", "p2"], computedAt: t0 });

    mockPrisma.closureCache.findUnique.mockResolvedValueOnce(null);
    expect(await store().getClosure("c1", "missing")).toBeNull();
  });

  it("releaseMembersOf filters by release and maps", async () => {
    mockPrisma.releaseMember.findMany.mockResolvedValueOnce([{ releaseId: "r1", kind: "Concept", entityId: "c1" }]);
    const out = await store().releaseMembersOf("r1");
    expect(mockPrisma.releaseMember.findMany).toHaveBeenCalledWith({ where: { releaseId: "r1" } });
    expect(out).toEqual([{ releaseId: "r1", kind: "Concept", entityId: "c1" }]);
  });
});

// ── mappings + whole-graph edge reads ────────────────────────────────────────
describe("mappings + edge reads (mappers, both fallback sides)", () => {
  it("mappingsForConcept maps examWeight present", async () => {
    mockPrisma.mapping.findMany.mockResolvedValueOnce([{ programNodeId: "n1", conceptId: "c1", depth: "MASTER", ordinal: 2, examWeight: 7, required: true }]);
    const out = await store().mappingsForConcept("c1");
    expect(mockPrisma.mapping.findMany).toHaveBeenCalledWith({ where: { conceptId: "c1" } });
    expect(out[0]).toEqual({ programNodeId: "n1", conceptId: "c1", depth: "MASTER", ordinal: 2, examWeight: 7, required: true });
  });

  it("mappingsUnderNode maps absent examWeight to null", async () => {
    mockPrisma.mapping.findMany.mockResolvedValueOnce([{ programNodeId: "n1", conceptId: "c1", depth: "ASSUMED", ordinal: 0, examWeight: undefined, required: false }]);
    const out = await store().mappingsUnderNode("n1");
    expect(mockPrisma.mapping.findMany).toHaveBeenCalledWith({ where: { programNodeId: "n1" } });
    expect(out[0].examWeight).toBeNull();
  });

  it("dependencyEdges maps contextId+supersedes present, then both null", async () => {
    mockPrisma.dependencyEdge.findMany.mockResolvedValueOnce([{ fromId: "a", toId: "b", strength: 0.9, contextId: "ctx", version: 2, supersedes: "old" }]);
    expect((await store().dependencyEdges())[0]).toEqual({ fromId: "a", toId: "b", strength: 0.9, contextId: "ctx", version: 2, supersedes: "old" });

    mockPrisma.dependencyEdge.findMany.mockResolvedValueOnce([{ fromId: "a", toId: "b", strength: 0.9, contextId: undefined, version: 2, supersedes: undefined }]);
    const nil = (await store().dependencyEdges())[0];
    expect(nil.contextId).toBeNull();
    expect(nil.supersedes).toBeNull();
  });

  it("compositionEdges maps ordinal present then null", async () => {
    mockPrisma.compositionEdge.findMany.mockResolvedValueOnce([{ partId: "p", wholeId: "w", ordinal: 3, version: 1 }]);
    expect((await store().compositionEdges())[0].ordinal).toBe(3);
    mockPrisma.compositionEdge.findMany.mockResolvedValueOnce([{ partId: "p", wholeId: "w", ordinal: undefined, version: 1 }]);
    expect((await store().compositionEdges())[0].ordinal).toBeNull();
  });

  it("reinforcementEdges maps contextId present then null (earned bool preserved)", async () => {
    mockPrisma.reinforcementEdge.findMany.mockResolvedValueOnce([{ fromId: "a", toId: "b", type: "ENABLES", strength: 0.4, earned: true, contextId: "ctx", version: 1 }]);
    const hit = (await store().reinforcementEdges())[0];
    expect(hit).toEqual({ fromId: "a", toId: "b", type: "ENABLES", strength: 0.4, earned: true, contextId: "ctx", version: 1 });

    mockPrisma.reinforcementEdge.findMany.mockResolvedValueOnce([{ fromId: "a", toId: "b", type: "ENABLES", strength: 0.4, earned: false, contextId: undefined, version: 1 }]);
    const nil = (await store().reinforcementEdges())[0];
    expect(nil.contextId).toBeNull();
    expect(nil.earned).toBe(false);
  });
});

// ── dumpAll — the deterministic whole-graph snapshot ─────────────────────────
describe("dumpAll — deterministic sorted snapshot", () => {
  // A full row for every table (nullables populated).
  const rowsFull = {
    concept: conceptRowFull,
    conceptAlias: { conceptId: "c1", alias: "maths", language: "en", kind: "SYNONYM" },
    conceptTag: { conceptId: "c1", namespace: "cbse", value: "algebra" },
    context: { id: "ctx1", dimensions: { g: "10" } },
    statement: stmtRow(),
    provenance: { statementId: "s1", sourceId: "src1", chunkId: "ch1", locator: { page: 1 }, quote: "q", extractorVersion: "e", promptVersion: "p", modelId: "m", extractedAt: t0 },
    source: { id: "src1", kind: "BOOK", title: "T", publisher: "P", authority: "A", edition: null, publishedAt: null, uri: null, checksum: "c", license: "CC", licenseUrl: null, ingestedAt: t0 },
    sourceChunk: { id: "ch1", sourceId: "src1", locator: { page: 1, range: [0, 3] }, text: "x", ordinal: 0 },
    dependencyEdge: { fromId: "a", toId: "b", strength: 1, contextId: "ctx", version: 1, supersedes: "o" },
    compositionEdge: { partId: "p", wholeId: "w", ordinal: 1, version: 1 },
    reinforcementEdge: { fromId: "a", toId: "b", type: "REVISITS", strength: 1, earned: true, contextId: "ctx", version: 1 },
    reviewEvent: { id: "r1", targetKind: "Statement", targetId: "s1", decision: "APPROVE", fromTrust: null, toTrust: null, actorId: "u1", before: {}, after: {}, reason: null, batchId: null, createdAt: t0 },
    teachingAsset: { id: "a1", kind: "ANALOGY", conceptId: "c1", statementId: "s1", payload: {}, contextId: "ctx", trustLevel: "AUTO_VALIDATED", scope: "PUBLIC", version: 1, supersedes: "a0" },
    assessmentItem: { id: "i1", kind: "MCQ", prompt: "?", payload: {}, contextId: "ctx", scope: "PUBLIC", trustLevel: "AUTO_VALIDATED", version: 1, supersedes: "i0" },
    itemConcept: { itemId: "i1", conceptId: "c1", role: "PRIMARY", bloom: "APPLY" },
    program: { id: "pg1", slug: "cbse", name: "CBSE", kind: "SCHOOL_BOARD", authority: "NCERT", jurisdiction: "IN", scope: "PUBLIC", version: "2024" },
    programNode: { id: "n1", programId: "pg1", parentId: "n0", nodeKind: "TOPIC", name: "Algebra", ordinal: 1, code: "1.1" },
    mapping: { programNodeId: "n1", conceptId: "c1", depth: "DEVELOP", ordinal: 1, examWeight: 5, required: true },
    release: { id: "2024-01-01-01", label: "R1", createdAt: t0, frozen: true },
    releaseMember: { releaseId: "2024-01-01-01", kind: "Concept", entityId: "c1" },
  };

  function loadDump(rows: typeof rowsFull) {
    mockPrisma.concept.findMany.mockResolvedValue([rows.concept]);
    mockPrisma.conceptAlias.findMany.mockResolvedValue([rows.conceptAlias]);
    mockPrisma.conceptTag.findMany.mockResolvedValue([rows.conceptTag]);
    mockPrisma.context.findMany.mockResolvedValue([rows.context]);
    mockPrisma.statement.findMany.mockResolvedValue([rows.statement]);
    mockPrisma.provenance.findMany.mockResolvedValue([rows.provenance]);
    mockPrisma.source.findMany.mockResolvedValue([rows.source]);
    mockPrisma.sourceChunk.findMany.mockResolvedValue([rows.sourceChunk]);
    mockPrisma.dependencyEdge.findMany.mockResolvedValue([rows.dependencyEdge]);
    mockPrisma.compositionEdge.findMany.mockResolvedValue([rows.compositionEdge]);
    mockPrisma.reinforcementEdge.findMany.mockResolvedValue([rows.reinforcementEdge]);
    mockPrisma.reviewEvent.findMany.mockResolvedValue([rows.reviewEvent]);
    mockPrisma.teachingAsset.findMany.mockResolvedValue([rows.teachingAsset]);
    mockPrisma.assessmentItem.findMany.mockResolvedValue([rows.assessmentItem]);
    mockPrisma.itemConcept.findMany.mockResolvedValue([rows.itemConcept]);
    mockPrisma.program.findMany.mockResolvedValue([rows.program]);
    mockPrisma.programNode.findMany.mockResolvedValue([rows.programNode]);
    mockPrisma.mapping.findMany.mockResolvedValue([rows.mapping]);
    mockPrisma.release.findMany.mockResolvedValue([rows.release]);
    mockPrisma.releaseMember.findMany.mockResolvedValue([rows.releaseMember]);
  }

  it("maps every table into the dump and each row is mapped through its mapper", async () => {
    loadDump(rowsFull);
    const dump = await store().dumpAll();

    expect(dump.concepts[0]).toEqual(conceptExpectedFull);
    expect(dump.conceptAliases[0]).toEqual(rowsFull.conceptAlias);
    expect(dump.conceptTags[0]).toEqual(rowsFull.conceptTag);
    expect(dump.contexts[0]).toEqual({ id: "ctx1", dimensions: { g: "10" } });
    expect(dump.statements[0].id).toBe("s1");
    expect(dump.provenance[0].statementId).toBe("s1");
    expect(dump.sources[0].id).toBe("src1");
    expect(dump.sourceChunks[0].id).toBe("ch1");
    expect(dump.dependencyEdges[0]).toMatchObject({ fromId: "a", supersedes: "o" });
    expect(dump.compositionEdges[0].ordinal).toBe(1);
    expect(dump.reinforcementEdges[0].type).toBe("REVISITS");
    expect(dump.reviewEvents[0].id).toBe("r1");
    expect(dump.teachingAssets[0]).toMatchObject({ id: "a1", statementId: "s1", supersedes: "a0" });
    expect(dump.assessmentItems[0]).toMatchObject({ id: "i1", supersedes: "i0" });
    expect(dump.itemConcepts[0]).toEqual({ itemId: "i1", conceptId: "c1", role: "PRIMARY", bloom: "APPLY" });
    expect(dump.programs[0]).toMatchObject({ id: "pg1", jurisdiction: "IN" });
    expect(dump.programNodes[0]).toMatchObject({ id: "n1", parentId: "n0", code: "1.1" });
    expect(dump.mappings[0]).toMatchObject({ programNodeId: "n1", examWeight: 5 });
    expect(dump.releases[0]).toEqual({ id: "2024-01-01-01", label: "R1", createdAt: t0, frozen: true });
    expect(dump.releaseMembers[0]).toEqual({ releaseId: "2024-01-01-01", kind: "Concept", entityId: "c1" });
  });

  it("uses the exact deterministic orderings (id asc + composite keys)", async () => {
    loadDump(rowsFull);
    await store().dumpAll();
    expect(mockPrisma.concept.findMany).toHaveBeenCalledWith({ orderBy: { id: "asc" } });
    expect(mockPrisma.statement.findMany).toHaveBeenCalledWith({ orderBy: { id: "asc" } });
    expect(mockPrisma.conceptAlias.findMany).toHaveBeenCalledWith({ orderBy: [{ conceptId: "asc" }, { alias: "asc" }] });
    expect(mockPrisma.conceptTag.findMany).toHaveBeenCalledWith({ orderBy: [{ conceptId: "asc" }, { namespace: "asc" }, { value: "asc" }] });
    expect(mockPrisma.provenance.findMany).toHaveBeenCalledWith({ orderBy: [{ statementId: "asc" }, { chunkId: "asc" }] });
    expect(mockPrisma.dependencyEdge.findMany).toHaveBeenCalledWith({ orderBy: [{ fromId: "asc" }, { toId: "asc" }, { version: "asc" }] });
    expect(mockPrisma.compositionEdge.findMany).toHaveBeenCalledWith({ orderBy: [{ partId: "asc" }, { wholeId: "asc" }, { version: "asc" }] });
    expect(mockPrisma.reinforcementEdge.findMany).toHaveBeenCalledWith({ orderBy: [{ fromId: "asc" }, { toId: "asc" }, { type: "asc" }, { version: "asc" }] });
    expect(mockPrisma.itemConcept.findMany).toHaveBeenCalledWith({ orderBy: [{ itemId: "asc" }, { conceptId: "asc" }] });
    expect(mockPrisma.mapping.findMany).toHaveBeenCalledWith({ orderBy: [{ programNodeId: "asc" }, { conceptId: "asc" }] });
    expect(mockPrisma.releaseMember.findMany).toHaveBeenCalledWith({ orderBy: [{ releaseId: "asc" }, { kind: "asc" }, { entityId: "asc" }] });
  });

  it("maps the nullable columns of dump-only mappers to null when absent", async () => {
    const rowsMin: typeof rowsFull = {
      ...rowsFull,
      itemConcept: { itemId: "i1", conceptId: "c1", role: "PRIMARY", bloom: undefined as unknown as string },
      program: { ...rowsFull.program, jurisdiction: undefined as unknown as string },
      programNode: { ...rowsFull.programNode, parentId: undefined as unknown as string, code: undefined as unknown as string },
    };
    loadDump(rowsMin);
    const dump = await store().dumpAll();
    expect(dump.itemConcepts[0].bloom).toBeNull();
    expect(dump.programs[0].jurisdiction).toBeNull();
    expect(dump.programNodes[0].parentId).toBeNull();
    expect(dump.programNodes[0].code).toBeNull();
  });
});
