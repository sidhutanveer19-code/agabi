import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type {
  Scope,
  ReadScope,
  TeachingAsset,
  AssessmentItem,
  Source,
  SourceChunk,
  Provenance,
  ReviewEvent,
  Program,
  ProgramNode,
  Release,
} from "@/server/knowledge/types";

/**
 * Mutation-killing coverage for the in-memory KnowledgeStore that the conformance suite
 * does NOT pin: the DISCRIMINATION in every scoped/filtered read (a filter that returns
 * everything, or flips `&&`→`||`, must go red), the `commitReview` DISPUTE branch, and the
 * deterministic ORDERING inside `dumpAll` (each sort-key function and its `<`/`>` comparator).
 *
 * The conformance "full write surface" test asserts MEMBERSHIP (`.some(...)`) over single-row
 * collections, so a broken filter or a dropped sort key survives it. Every test here inserts
 * ≥2 discriminating rows and asserts the EXACT surviving/ordered result (§H1.2/.3/.5).
 */

const PUB = "PUBLIC" as ReadScope;
const S_A = "tenant:a" as Scope;
const S_B = "tenant:b" as Scope;

async function ctxId(store: ReturnType<typeof createMemoryStore>): Promise<string> {
  return (await store.putContext({ k: "v" })).id;
}

// ── getStatement — the happy path the disputed test never exercises ──────────
describe("memory.getStatement — returns a visible, non-disputed row (kills the guard booleans)", () => {
  it("serves a present, visible, non-disputed statement under a permissive policy", async () => {
    const store = createMemoryStore();
    const cid = await ctxId(store);
    const s = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "X", predicate: "p", objectId: "O" }, text: "t", contextId: cid }), subjectId: "X" };
    await store.putStatement(s);
    const got = await store.getStatement(s.id, PUB, POLICIES.RND);
    expect(got).not.toBeNull();
    expect(got?.id).toBe(s.id);
    expect(got?.labelled).toBe(false);
  });

  it("hides a statement whose scope is another tenant (visible=false → null)", async () => {
    const store = createMemoryStore();
    const cid = await ctxId(store);
    const s = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "X", predicate: "p", objectId: "O" }, text: "t", contextId: cid, scope: S_A }), subjectId: "X" };
    await store.putStatement(s);
    expect(await store.getStatement(s.id, S_B, POLICIES.RND)).toBeNull(); // cross-tenant
    expect(await store.getStatement(s.id, S_A, POLICIES.RND)).not.toBeNull(); // own tenant
  });
});

// ── statementsForSubject — subjectId filter must discriminate ────────────────
describe("memory.statementsForSubject — filters by subjectId + scope, not everything", () => {
  it("returns only the matching subject; a different-subject row is excluded", async () => {
    const store = createMemoryStore();
    const cid = await ctxId(store);
    const mine = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "MINE", predicate: "p", objectId: "O" }, text: "t", contextId: cid }), subjectId: "MINE" };
    const other = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "OTHER", predicate: "p", objectId: "O" }, text: "t", contextId: cid }), subjectId: "OTHER" };
    await store.putStatement(mine);
    await store.putStatement(other);
    const rows = await store.statementsForSubject("MINE", PUB, POLICIES.RND);
    expect(rows.map((r) => r.id)).toEqual([mine.id]);
  });

  it("excludes a same-subject row that belongs to a different tenant", async () => {
    const store = createMemoryStore();
    const cid = await ctxId(store);
    const pub = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "SUB", predicate: "p", objectId: "O" }, text: "t", contextId: cid }), subjectId: "SUB" };
    const secret = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "SUB", predicate: "p", objectId: "O" }, text: "t", contextId: cid, scope: S_A }), subjectId: "SUB" };
    await store.putStatement(pub);
    await store.putStatement(secret);
    expect((await store.statementsForSubject("SUB", PUB, POLICIES.RND)).map((r) => r.id)).toEqual([pub.id]);
    expect((await store.statementsForSubject("SUB", S_A, POLICIES.RND)).map((r) => r.id).sort()).toEqual([pub.id, secret.id].sort());
  });
});

// ── assetsForConcept — conceptId AND scope filter (kills &&→||, drop-filter) ──
describe("memory.assetsForConcept — filters by conceptId AND scope", () => {
  const asset = (id: string, conceptId: string, scope: Scope): TeachingAsset => ({
    id, kind: "ANALOGY", conceptId, statementId: null, payload: {}, contextId: "ctx",
    trustLevel: "MACHINE_PROPOSED", scope, version: 1, supersedes: null,
  });

  it("returns only assets of the concept that are visible in scope", async () => {
    const store = createMemoryStore();
    await store.putTeachingAsset(asset("keep", "C1", "PUBLIC" as Scope));
    await store.putTeachingAsset(asset("wrong-concept", "C2", "PUBLIC" as Scope));
    await store.putTeachingAsset(asset("wrong-scope", "C1", S_A));
    const out = await store.assetsForConcept("C1", PUB, POLICIES.RND);
    expect(out.map((a) => a.id)).toEqual(["keep"]);
  });

  it("with OR instead of AND a wrong-concept public asset would leak — it must not", async () => {
    const store = createMemoryStore();
    await store.putTeachingAsset(asset("c1", "C1", "PUBLIC" as Scope));
    await store.putTeachingAsset(asset("c2pub", "C2", "PUBLIC" as Scope)); // matches scope, not concept
    const out = await store.assetsForConcept("C1", PUB, POLICIES.RND);
    expect(out.map((a) => a.id)).toEqual(["c1"]);
  });
});

// ── itemsForConcept — itemConcepts link filter + item scope filter + dedup ───
describe("memory.itemsForConcept — link filter, scope filter and itemId dedup", () => {
  const item = (id: string, scope: Scope): AssessmentItem => ({
    id, kind: "MCQ", prompt: "?", payload: {}, contextId: "ctx", scope,
    trustLevel: "MACHINE_PROPOSED", version: 1, supersedes: null,
  });

  it("returns only linked items visible in scope; unlinked + wrong-scope excluded", async () => {
    const store = createMemoryStore();
    await store.putAssessmentItem(item("linked", "PUBLIC" as Scope));
    await store.putAssessmentItem(item("unlinked", "PUBLIC" as Scope));
    await store.putAssessmentItem(item("linked-secret", S_A));
    await store.putItemConcept({ itemId: "linked", conceptId: "C1", role: "PRIMARY", bloom: null });
    await store.putItemConcept({ itemId: "linked", conceptId: "C1", role: "PRIMARY", bloom: null }); // duplicate link → dedup
    await store.putItemConcept({ itemId: "linked-secret", conceptId: "C1", role: "PRIMARY", bloom: null });
    await store.putItemConcept({ itemId: "unrelated", conceptId: "C2", role: "PRIMARY", bloom: null });

    const out = await store.itemsForConcept("C1", PUB, POLICIES.RND);
    expect(out.map((i) => i.id)).toEqual(["linked"]); // deduped, scope-filtered, link-filtered
  });
});

// ── releaseMembersOf — filters by releaseId ──────────────────────────────────
describe("memory.releaseMembersOf — only the queried release's members", () => {
  it("excludes members of a different release", async () => {
    const store = createMemoryStore();
    await store.putRelease({ id: "rel-1", label: "r1", createdAt: new Date(), frozen: false }, [
      { releaseId: "rel-1", kind: "Statement", entityId: "s1" },
    ]);
    await store.putRelease({ id: "rel-2", label: "r2", createdAt: new Date(), frozen: false }, [
      { releaseId: "rel-2", kind: "Statement", entityId: "s2" },
    ]);
    const out = await store.releaseMembersOf("rel-1");
    expect(out.map((m) => m.entityId)).toEqual(["s1"]);
  });
});

// ── provenanceFor / reviewEventsFor / mappings — filter discrimination ────────
describe("memory.provenanceFor / reviewEventsFor / mappings — filter discrimination", () => {
  it("provenanceFor returns only the queried statement's rows", async () => {
    const store = createMemoryStore();
    const p = (statementId: string, chunkId: string): Provenance => ({ statementId, sourceId: "src", chunkId, locator: { page: 1, range: [0, 0] }, quote: "q", extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date() });
    await store.putProvenance(p("s1", "c1"));
    await store.putProvenance(p("s2", "c2"));
    expect((await store.provenanceFor("s1")).map((x) => x.chunkId)).toEqual(["c1"]);
  });

  it("reviewEventsFor discriminates on BOTH targetKind and targetId", async () => {
    const store = createMemoryStore();
    const ev = (id: string, kind: string, targetId: string): ReviewEvent => ({ id, targetKind: kind, targetId, decision: "APPROVE", fromTrust: null, toTrust: null, actorId: "human", before: null, after: null, reason: null, batchId: null, createdAt: new Date() });
    await store.putReviewEvent(ev("e1", "Statement", "s1"));
    await store.putReviewEvent(ev("e2", "Statement", "s2")); // right kind, wrong id
    await store.putReviewEvent(ev("e3", "Concept", "s1")); // wrong kind, right id
    expect((await store.reviewEventsFor("Statement", "s1")).map((e) => e.id)).toEqual(["e1"]);
  });

  it("mappingsForConcept / mappingsUnderNode discriminate on their key", async () => {
    const store = createMemoryStore();
    await store.putMapping({ programNodeId: "n1", conceptId: "C1", depth: "INTRODUCE", ordinal: 0, examWeight: null, required: true });
    await store.putMapping({ programNodeId: "n2", conceptId: "C2", depth: "INTRODUCE", ordinal: 0, examWeight: null, required: true });
    expect((await store.mappingsForConcept("C1")).map((m) => m.programNodeId)).toEqual(["n1"]);
    expect((await store.mappingsUnderNode("n2")).map((m) => m.conceptId)).toEqual(["C2"]);
  });
});

// ── conceptsByAlias — alias filter, scope filter, dedup ───────────────────────
describe("memory.conceptsByAlias — alias match, scope filter, concept dedup", () => {
  it("returns visible concepts that carry the alias, deduped; excludes other-alias + invisible", async () => {
    const store = createMemoryStore();
    const c1 = { ...buildConcept({ name: "Velocity" }), id: "cid1" };
    const c2 = { ...buildConcept({ name: "Speed", scope: S_A }), id: "cid2" };
    await store.putConcept(c1);
    await store.putConcept(c2);
    await store.putConceptAlias({ conceptId: "cid1", alias: "rate", language: "en", kind: "SYNONYM" });
    await store.putConceptAlias({ conceptId: "cid1", alias: "rate", language: "fr", kind: "SYNONYM" }); // dup id under same alias
    await store.putConceptAlias({ conceptId: "cid2", alias: "rate", language: "en", kind: "SYNONYM" });
    await store.putConceptAlias({ conceptId: "cid1", alias: "other", language: "en", kind: "SYNONYM" });

    // PUBLIC scope: only c1 (c2 is tenant:a, invisible); deduped to a single row
    const pub = await store.conceptsByAlias("rate", PUB);
    expect(pub.map((c) => c.id)).toEqual(["cid1"]);
    // tenant:a scope: sees both public c1 and its own c2
    const ta = await store.conceptsByAlias("rate", S_A);
    expect(ta.map((c) => c.id).sort()).toEqual(["cid1", "cid2"]);
  });
});

// ── trigramConcepts — fuzzy match over name/alias, threshold, order, scope ────
describe("memory.trigramConcepts — best-of name/alias, threshold gate, score-desc order", () => {
  it("ranks an exact name match above a weaker one and drops below-threshold + invisible", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Photosynthesis" }), id: "exact" });
    await store.putConcept({ ...buildConcept({ name: "Photograph" }), id: "weak" });
    await store.putConcept({ ...buildConcept({ name: "Photosynthesis", scope: S_A }), id: "secret" });
    const out = await store.trigramConcepts("Photosynthesis", PUB, 0.3);
    expect(out[0].concept.id).toBe("exact");
    expect(out[0].score).toBeGreaterThanOrEqual(out[out.length - 1].score); // sorted descending
    expect(out.map((r) => r.concept.id)).not.toContain("secret"); // scope filtered
  });

  it("matches via an ALIAS when it beats the name, reporting matchedOn alias", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "H2O" }), id: "water" });
    await store.putConceptAlias({ conceptId: "water", alias: "Photosynthesis", language: "en", kind: "SYNONYM" });
    const out = await store.trigramConcepts("Photosynthesis", PUB, 0.3);
    const hit = out.find((r) => r.concept.id === "water");
    expect(hit).toBeDefined();
    expect(hit?.matchedOn).toBe("alias:Photosynthesis");
  });

  it("an unrelated query below threshold returns nothing", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Photosynthesis" }), id: "p" });
    expect(await store.trigramConcepts("xyzzy-qwerty", PUB, 0.3)).toEqual([]);
  });
});

// ── searchChunks — default limit, explicit-limit slice, ordinal tiebreak ──────
describe("memory.searchChunks — limit default/override + ordinal tiebreak on equal score", () => {
  const src: Source = { id: "src", kind: "book", title: "T", publisher: "P", authority: "A", edition: null, publishedAt: null, uri: null, checksum: "c", license: "L", licenseUrl: null, ingestedAt: new Date() };
  const chunk = (id: string, ordinal: number, text: string): SourceChunk => ({ id, sourceId: "src", locator: { page: 1, range: [0, 0] }, text, ordinal });

  it("defaults the limit to 8 (a 9th equal-scoring chunk is dropped)", async () => {
    const store = createMemoryStore();
    await store.putSource(src);
    for (let i = 0; i < 9; i++) await store.putSourceChunk(chunk(`c${i}`, i, "prime number"));
    const out = await store.searchChunks("prime"); // no opts → default 8
    expect(out).toHaveLength(8);
  });

  it("honours an explicit limit and, on equal score, orders by ordinal ascending", async () => {
    const store = createMemoryStore();
    await store.putSource(src);
    await store.putSourceChunk(chunk("late", 5, "prime number"));
    await store.putSourceChunk(chunk("early", 1, "prime number"));
    const out = await store.searchChunks("prime", { limit: 5 });
    expect(out.map((r) => r.chunk.id)).toEqual(["early", "late"]); // equal score → ordinal asc
    const capped = await store.searchChunks("prime", { limit: 1 });
    expect(capped.map((r) => r.chunk.id)).toEqual(["early"]);
  });
});

// ── listSources / chunksForSource — ordering + source discrimination ──────────
describe("memory.listSources / chunksForSource — ordering and filtering", () => {
  const mkSource = (id: string): Source => ({ id, kind: "book", title: "T", publisher: "P", authority: "A", edition: null, publishedAt: null, uri: null, checksum: id, license: "L", licenseUrl: null, ingestedAt: new Date() });

  it("listSources returns sources sorted by id ascending regardless of insert order", async () => {
    const store = createMemoryStore();
    await store.putSource(mkSource("src-z"));
    await store.putSource(mkSource("src-a"));
    expect((await store.listSources()).map((s) => s.id)).toEqual(["src-a", "src-z"]);
  });

  it("chunksForSource filters by sourceId and orders by ordinal ascending", async () => {
    const store = createMemoryStore();
    await store.putSource(mkSource("src-1"));
    await store.putSource(mkSource("src-2"));
    await store.putSourceChunk({ id: "b", sourceId: "src-1", locator: { page: 1, range: [0, 0] }, text: "t", ordinal: 5 });
    await store.putSourceChunk({ id: "a", sourceId: "src-1", locator: { page: 1, range: [0, 0] }, text: "t", ordinal: 1 });
    await store.putSourceChunk({ id: "other", sourceId: "src-2", locator: { page: 1, range: [0, 0] }, text: "t", ordinal: 0 });
    const out = await store.chunksForSource("src-1");
    expect(out.map((c) => c.id)).toEqual(["a", "b"]); // ordinal asc, other-source excluded
  });
});

// ── commitReview — the DISPUTE branch (and non-Statement / missing target) ───
describe("memory.commitReview — dispute effect and target guards", () => {
  async function seed(store: ReturnType<typeof createMemoryStore>) {
    const cid = await ctxId(store);
    const s = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "X", predicate: "p", objectId: "O" }, text: "t", contextId: cid }), subjectId: "X" };
    await store.putStatement(s);
    return s;
  }
  const ev = (targetId: string): ReviewEvent => ({ id: "rev1", targetKind: "Statement", targetId, decision: "DISPUTE", fromTrust: null, toTrust: null, actorId: "human", before: null, after: null, reason: null, batchId: null, createdAt: new Date() });

  it("writes the four dispute columns onto the statement (dispute branch)", async () => {
    const store = createMemoryStore();
    const s = await seed(store);
    const at = new Date("2025-01-01T00:00:00.000Z");
    await store.commitReview(ev(s.id), { targetKind: "Statement", targetId: s.id, dispute: { disputed: true, reason: "conflict", priorTrustLevel: "AUTO_VALIDATED", at } });
    const raw = await store.getStatementRaw(s.id);
    expect(raw?.disputed).toBe(true);
    expect(raw?.disputeReason).toBe("conflict");
    expect(raw?.priorTrustLevel).toBe("AUTO_VALIDATED");
    expect(raw?.disputedAt).toEqual(at);
    // the event was still appended
    expect(await store.reviewEventsFor("Statement", s.id)).toHaveLength(1);
  });

  it("a non-Statement effect appends the event but touches no statement", async () => {
    const store = createMemoryStore();
    const s = await seed(store);
    await store.commitReview({ ...ev(s.id), targetKind: "Concept", targetId: "C1" }, { targetKind: "Concept", targetId: "C1", trustLevel: "COMMUNITY_REVIEWED" });
    expect((await store.getStatementRaw(s.id))?.trustLevel).toBe("MACHINE_PROPOSED"); // unchanged
    expect(await store.reviewEventsFor("Concept", "C1")).toHaveLength(1);
  });

  it("a Statement effect for a MISSING statement is a no-op on content, event still appended", async () => {
    const store = createMemoryStore();
    await store.commitReview(ev("ghost"), { targetKind: "Statement", targetId: "ghost", trustLevel: "COMMUNITY_REVIEWED" });
    expect(await store.getStatementRaw("ghost")).toBeNull();
    expect(await store.reviewEventsFor("Statement", "ghost")).toHaveLength(1);
  });
});

// ── dumpAll — deterministic ordering: every sort key + comparator direction ───
describe("memory.dumpAll — deterministic ordering (kills sort-key arrows + comparator)", () => {
  it("orders every collection by its documented key, independent of insertion order", async () => {
    const store = createMemoryStore();

    // Insert each pair in REVERSE of the sorted order so a dropped/emptied key (→ stable insertion
    // order) yields the WRONG order and the assertion fails.

    // byId collections (id asc) — ids chosen so insertion order (z then a) ≠ sorted (a then z)
    await store.putConcept({ ...buildConcept({ name: "Zeta" }), id: "c-z" });
    await store.putConcept({ ...buildConcept({ name: "Alpha" }), id: "c-a" });

    const cid = await ctxId(store);
    await store.putStatement({ ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "X", predicate: "p", objectId: "O" }, text: "t", contextId: cid }), id: "s-z" });
    await store.putStatement({ ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "X", predicate: "p", objectId: "O" }, text: "t", contextId: cid }), id: "s-a" });

    await store.putSource({ id: "src-z", kind: "book", title: "T", publisher: "P", authority: "A", edition: null, publishedAt: null, uri: null, checksum: "z", license: "L", licenseUrl: null, ingestedAt: new Date() });
    await store.putSource({ id: "src-a", kind: "book", title: "T", publisher: "P", authority: "A", edition: null, publishedAt: null, uri: null, checksum: "a", license: "L", licenseUrl: null, ingestedAt: new Date() });

    await store.putSourceChunk({ id: "ch-z", sourceId: "src-z", locator: { page: 1, range: [0, 0] }, text: "t", ordinal: 0 });
    await store.putSourceChunk({ id: "ch-a", sourceId: "src-a", locator: { page: 1, range: [0, 0] }, text: "t", ordinal: 0 });

    await store.putReviewEvent({ id: "r-z", targetKind: "Statement", targetId: "s-z", decision: "APPROVE", fromTrust: null, toTrust: null, actorId: "h", before: null, after: null, reason: null, batchId: null, createdAt: new Date() });
    await store.putReviewEvent({ id: "r-a", targetKind: "Statement", targetId: "s-a", decision: "APPROVE", fromTrust: null, toTrust: null, actorId: "h", before: null, after: null, reason: null, batchId: null, createdAt: new Date() });

    await store.putTeachingAsset({ id: "ta-z", kind: "ANALOGY", conceptId: "c-z", statementId: null, payload: {}, contextId: cid, trustLevel: "MACHINE_PROPOSED", scope: "PUBLIC" as Scope, version: 1, supersedes: null });
    await store.putTeachingAsset({ id: "ta-a", kind: "ANALOGY", conceptId: "c-a", statementId: null, payload: {}, contextId: cid, trustLevel: "MACHINE_PROPOSED", scope: "PUBLIC" as Scope, version: 1, supersedes: null });

    await store.putAssessmentItem({ id: "ai-z", kind: "MCQ", prompt: "?", payload: {}, contextId: cid, scope: "PUBLIC" as Scope, trustLevel: "MACHINE_PROPOSED", version: 1, supersedes: null });
    await store.putAssessmentItem({ id: "ai-a", kind: "MCQ", prompt: "?", payload: {}, contextId: cid, scope: "PUBLIC" as Scope, trustLevel: "MACHINE_PROPOSED", version: 1, supersedes: null });

    const prog = (id: string): Program => ({ id, slug: id, name: id, kind: "SCHOOL_BOARD", authority: "A", jurisdiction: "IN", scope: "PUBLIC" as Scope, version: "1" });
    await store.putProgram(prog("pg-z"));
    await store.putProgram(prog("pg-a"));

    const node = (id: string): ProgramNode => ({ id, programId: "pg-a", parentId: null, nodeKind: "TOPIC", name: id, ordinal: 0, code: null });
    await store.putProgramNode(node("pn-z"));
    await store.putProgramNode(node("pn-a"));

    const rel = (id: string): Release => ({ id, label: id, createdAt: new Date(), frozen: false });
    // releaseMembers sorted by `${releaseId}|${kind}|${entityId}` — insert kinds Z then A
    await store.putRelease(rel("rel-z"), []);
    await store.putRelease(rel("rel-a"), [
      { releaseId: "rel-a", kind: "Zeta", entityId: "e1" },
      { releaseId: "rel-a", kind: "Alpha", entityId: "e1" },
    ]);

    // multi-field key collections — insert z then a
    await store.putConceptAlias({ conceptId: "c-z", alias: "x", language: "en", kind: "SYNONYM" });
    await store.putConceptAlias({ conceptId: "c-a", alias: "x", language: "en", kind: "SYNONYM" });

    await store.putConceptTag({ conceptId: "c-z", namespace: "ns", value: "v" });
    await store.putConceptTag({ conceptId: "c-a", namespace: "ns", value: "v" });

    await store.putProvenance({ statementId: "s-z", sourceId: "src-z", chunkId: "ch-z", locator: { page: 1, range: [0, 0] }, quote: "q", extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date() });
    await store.putProvenance({ statementId: "s-a", sourceId: "src-a", chunkId: "ch-a", locator: { page: 1, range: [0, 0] }, quote: "q", extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date() });

    await store.putDependencyEdge({ fromId: "z", toId: "t", strength: 1, contextId: null, version: 1, supersedes: null });
    await store.putDependencyEdge({ fromId: "a", toId: "t", strength: 1, contextId: null, version: 1, supersedes: null });

    await store.putCompositionEdge({ partId: "z", wholeId: "w", ordinal: 0, version: 1 });
    await store.putCompositionEdge({ partId: "a", wholeId: "w", ordinal: 0, version: 1 });

    await store.putReinforcementEdge({ fromId: "z", toId: "t", type: "REINFORCES", strength: 1, earned: false, contextId: null, version: 1 });
    await store.putReinforcementEdge({ fromId: "a", toId: "t", type: "REINFORCES", strength: 1, earned: false, contextId: null, version: 1 });

    await store.putItemConcept({ itemId: "z", conceptId: "c", role: "PRIMARY", bloom: null });
    await store.putItemConcept({ itemId: "a", conceptId: "c", role: "PRIMARY", bloom: null });

    await store.putMapping({ programNodeId: "z", conceptId: "c", depth: "INTRODUCE", ordinal: 0, examWeight: null, required: true });
    await store.putMapping({ programNodeId: "a", conceptId: "c", depth: "INTRODUCE", ordinal: 0, examWeight: null, required: true });

    const dump = await store.dumpAll();

    expect(dump.concepts.map((c) => c.id)).toEqual(["c-a", "c-z"]);
    expect(dump.statements.map((s) => s.id)).toEqual(["s-a", "s-z"]);
    expect(dump.sources.map((s) => s.id)).toEqual(["src-a", "src-z"]);
    expect(dump.sourceChunks.map((c) => c.id)).toEqual(["ch-a", "ch-z"]);
    expect(dump.reviewEvents.map((r) => r.id)).toEqual(["r-a", "r-z"]);
    expect(dump.teachingAssets.map((a) => a.id)).toEqual(["ta-a", "ta-z"]);
    expect(dump.assessmentItems.map((a) => a.id)).toEqual(["ai-a", "ai-z"]);
    expect(dump.programs.map((p) => p.id)).toEqual(["pg-a", "pg-z"]);
    expect(dump.programNodes.map((n) => n.id)).toEqual(["pn-a", "pn-z"]);
    expect(dump.releases.map((r) => r.id)).toEqual(["rel-a", "rel-z"]);

    expect(dump.conceptAliases.map((a) => a.conceptId)).toEqual(["c-a", "c-z"]);
    expect(dump.conceptTags.map((t) => t.conceptId)).toEqual(["c-a", "c-z"]);
    expect(dump.provenance.map((p) => p.statementId)).toEqual(["s-a", "s-z"]);
    expect(dump.dependencyEdges.map((e) => e.fromId)).toEqual(["a", "z"]);
    expect(dump.compositionEdges.map((e) => e.partId)).toEqual(["a", "z"]);
    expect(dump.reinforcementEdges.map((e) => e.fromId)).toEqual(["a", "z"]);
    expect(dump.itemConcepts.map((l) => l.itemId)).toEqual(["a", "z"]);
    expect(dump.mappings.map((m) => m.programNodeId)).toEqual(["a", "z"]);
    expect(dump.releaseMembers.map((m) => m.kind)).toEqual(["Alpha", "Zeta"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECOND PASS — mutants the first pass left alive. Each test below pins the ONE
//  behaviour a specific surviving/uncovered mutant changes. Comments name the
//  mutant (line:col Mutator) so the link to the report is explicit.
// ─────────────────────────────────────────────────────────────────────────────

// ── sortBy stability (L32:90) — the comparator's `0`-for-equal is what keeps the
//    sort STABLE; `→true` (always -1) and `<=` (equal→-1) both REVERSE tied rows.
//    dumpAll.conceptAliases sorts by `${conceptId}|${alias}`, so two aliases with
//    the SAME concept+alias tie — their insertion order must survive. (The first
//    pass only used DISTINCT reverse-sorted keys, where "always -1" = "sorted".)
describe("memory sortBy — stable on tied keys (L32:90 →true / <=)", () => {
  it("keeps insertion order for aliases whose sort key is identical", async () => {
    const store = createMemoryStore();
    await store.putConceptAlias({ conceptId: "cs", alias: "dup", language: "en", kind: "SYNONYM" });
    await store.putConceptAlias({ conceptId: "cs", alias: "dup", language: "fr", kind: "SYNONYM" });
    const dump = await store.dumpAll();
    const langs = dump.conceptAliases.filter((a) => a.conceptId === "cs" && a.alias === "dup").map((a) => a.language);
    expect(langs).toEqual(["en", "fr"]); // stable — a reversing comparator yields ["fr","en"]
  });
});

// ── closureKey (L63:64 StringLiteral / L63:22 ArrowFunction) — the key must be
//    `${conceptId}@${releaseId}`. An empty template / undefined arrow collapses
//    ALL closures onto one bucket, so distinct keys must fetch distinct entries.
describe("memory closure cache — key discriminates conceptId@releaseId (L63)", () => {
  it("stores and retrieves each closure under its own composite key", async () => {
    const store = createMemoryStore();
    await store.putClosure({ conceptId: "cA", releaseId: "rel1", closure: ["p1"], computedAt: new Date(0) });
    await store.putClosure({ conceptId: "cB", releaseId: "rel2", closure: ["p2", "p3"], computedAt: new Date(0) });
    expect((await store.getClosure("cA", "rel1"))?.closure).toEqual(["p1"]);
    expect((await store.getClosure("cB", "rel2"))?.closure).toEqual(["p2", "p3"]);
    expect(await store.getClosure("cA", "rel2")).toBeNull(); // a collapsed key would return cB's entry here
  });
});

// ── resolveSlug via lookupFor.byId visibility (L72:14 →true / &&→||) — reached on
//    the mergedInto chain: a PUBLIC loser merged into a tenant-private winner must
//    NOT resolve at PUBLIC, because byId refuses to hand back the invisible winner.
describe("memory resolveSlug — byId honours scope on the merge chain (L72:14)", () => {
  it("does not follow a merge into a concept invisible at the read scope", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Winner", scope: S_A }), id: "winner", slug: "winner" });
    await store.putConcept({ ...buildConcept({ name: "Loser" }), id: "loser", slug: "loser", mergedInto: "winner" });
    expect(await store.resolveSlug("loser", PUB)).toEqual({ kind: "none" }); // byId(winner) → invisible → none
    expect(await store.resolveSlug("loser", S_A)).toEqual({ kind: "concept", conceptId: "winner" }); // own tenant resolves
  });
});

// ── resolveSlug via formerName predicate (L76:65 →true) — the `x.alias === slug`
//    half of the find MUST discriminate: a FORMER_NAME alias for "oldname" must not
//    resolve an UNRELATED query slug.
describe("memory resolveSlug — former-name find matches the slug, not just the kind (L76:65)", () => {
  it("a FORMER_NAME alias does not resolve a different, unknown slug", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Target" }), id: "cTarget", slug: "target" });
    await store.putConceptAlias({ conceptId: "cTarget", alias: "oldname", language: "en", kind: "FORMER_NAME" });
    expect(await store.resolveSlug("unrelated-slug", PUB)).toEqual({ kind: "none" }); // →true would match "oldname"
    expect(await store.resolveSlug("oldname", PUB)).toEqual({ kind: "concept", conceptId: "cTarget" }); // real former name resolves
  });
});

// ── resolveSlug via formerName return (L79:14 &&→||) — when the alias points at a
//    NONEXISTENT concept, `c && visible` short-circuits on the missing `c`; `c ||
//    visible` instead evaluates `visible(c.scope,…)` on `undefined` and throws.
describe("memory resolveSlug — former-name to a missing concept is `none`, not a throw (L79:14 ||)", () => {
  it("resolves to none when the FORMER_NAME alias points to no concept", async () => {
    const store = createMemoryStore();
    await store.putConceptAlias({ conceptId: "does-not-exist", alias: "phantom", language: "en", kind: "FORMER_NAME" });
    expect(await store.resolveSlug("phantom", PUB)).toEqual({ kind: "none" }); // `||` mutant throws on undefined.scope
  });
});

// ── commitReview target-kind guard (L134:11 →true) — a non-Statement effect whose
//    targetId COLLIDES with a real statement id must leave that statement alone.
//    (The first pass used a non-colliding id, so `statements.get` missed and the
//    →true mutant looked harmless.)
describe("memory commitReview — non-Statement effect never mutates a same-id statement (L134:11)", () => {
  it("leaves a statement untouched when the effect targets a Concept with the same id", async () => {
    const store = createMemoryStore();
    const cid = (await store.putContext({ k: "v" })).id;
    const s = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "X", predicate: "p", objectId: "O" }, text: "t", contextId: cid }), subjectId: "X" };
    await store.putStatement(s);
    const event: ReviewEvent = { id: "rv", targetKind: "Concept", targetId: s.id, decision: "APPROVE", fromTrust: null, toTrust: null, actorId: "human", before: null, after: null, reason: null, batchId: null, createdAt: new Date() };
    await store.commitReview(event, { targetKind: "Concept", targetId: s.id, trustLevel: "COMMUNITY_REVIEWED" });
    expect((await store.getStatementRaw(s.id))?.trustLevel).toBe("MACHINE_PROPOSED"); // →true would overwrite it
  });
});

// ── putContext idempotence (L150:11 →false) — the second put of an identical
//    context returns the SAME row instance; `if(existing)`→false rebuilds a fresh
//    object, breaking reference identity.
describe("memory putContext — idempotent by canonical hash returns the same row (L150:11)", () => {
  it("returns the identical stored instance on a repeat put", async () => {
    const store = createMemoryStore();
    const first = await store.putContext({ k: "boundary" });
    const second = await store.putContext({ k: "boundary" });
    expect(second).toBe(first); // →false returns a new {id,dimensions} object, failing toBe
  });
});

// ── conceptsByAlias alias filter (L180:49 →true / L180:27 .filter dropped) — the
//    alias filter must discriminate: a concept carrying a DIFFERENT alias must not
//    leak in. (The first pass reused ids so a match-all still deduped to one row.)
describe("memory conceptsByAlias — the alias filter discriminates (L180)", () => {
  it("excludes a concept whose only alias is a different string", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Keeper" }), id: "cKeep" });
    await store.putConcept({ ...buildConcept({ name: "Other" }), id: "cOther" });
    await store.putConceptAlias({ conceptId: "cKeep", alias: "match", language: "en", kind: "SYNONYM" });
    await store.putConceptAlias({ conceptId: "cOther", alias: "nomatch", language: "en", kind: "SYNONYM" });
    expect((await store.conceptsByAlias("match", PUB)).map((c) => c.id)).toEqual(["cKeep"]); // match-all leaks cOther
  });
});

// ── trigramConcepts — bogus sentinel arrays (L185:100 / L191:54 ArrayDeclaration).
//    Both alias-list literals must stay EMPTY: the "Stryker was here" sentinel must
//    never become a matchable alias, for a concept that has aliases (L185, the
//    `set(id, [])` seed) and one that has none (L191, the `?? []` default).
describe("memory trigramConcepts — sentinel arrays never match (L185:100 / L191:54)", () => {
  it("neither an aliased nor an alias-less concept matches the injected sentinel string", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Quantum" }), id: "q-with-alias" });
    await store.putConceptAlias({ conceptId: "q-with-alias", alias: "quark", language: "en", kind: "SYNONYM" });
    await store.putConcept({ ...buildConcept({ name: "Zebra" }), id: "z-no-alias" });
    const ids = (await store.trigramConcepts("Stryker was here", PUB, 0.5)).map((r) => r.concept.id);
    expect(ids).not.toContain("q-with-alias"); // L185: seeded [] must not be ["Stryker was here"]
    expect(ids).not.toContain("z-no-alias"); // L191: `?? []` default must not be `?? ["Stryker was here"]`
  });
});

// ── trigramConcepts — name matchedOn label + alias-loop comparator (L190:25 String,
//    L193:15 →true and `>=`). A strong NAME match must report `name:<name>` at the
//    real score; a weak alias must NOT overwrite it (`s > best`), and an EQUAL alias
//    must not either (kills `>=`).
describe("memory trigramConcepts — name label wins over weaker/equal aliases (L190 / L193)", () => {
  it("keeps the name match and its score when the alias scores lower (L190 empty / L193 →true)", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Photosynthesis" }), id: "photo" });
    await store.putConceptAlias({ conceptId: "photo", alias: "zzz", language: "en", kind: "SYNONYM" });
    const hit = (await store.trigramConcepts("Photosynthesis", PUB, 0.2)).find((r) => r.concept.id === "photo");
    expect(hit).toBeDefined();
    expect(hit?.matchedOn).toBe("name:Photosynthesis"); // "" (L190) or "alias:zzz" (L193 →true) would differ
    expect(hit?.score).toBeCloseTo(1, 10); // the weak alias (0) must not overwrite the name score
  });

  it("does NOT switch to an alias that merely TIES the name score (L193:15 >=)", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Photosynthesis" }), id: "eqc" });
    await store.putConceptAlias({ conceptId: "eqc", alias: "Photosynthesis", language: "en", kind: "SYNONYM" });
    const hit = (await store.trigramConcepts("Photosynthesis", PUB, 0.2)).find((r) => r.concept.id === "eqc");
    expect(hit?.matchedOn).toBe("name:Photosynthesis"); // `s >= best` (equal) would switch to alias:Photosynthesis
  });
});

// ── trigramConcepts threshold boundary (L195:13 `>=`→`>`) — a concept scoring
//    EXACTLY the threshold is admitted by `>=`, dropped by `>`. An exact-name match
//    scores precisely 1.0, so a threshold of 1.0 sits on the boundary.
describe("memory trigramConcepts — threshold is inclusive (L195:13)", () => {
  it("admits a concept whose score exactly equals the threshold", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Boundary" }), id: "bnd" });
    const ids = (await store.trigramConcepts("Boundary", PUB, 1.0)).map((r) => r.concept.id);
    expect(ids).toContain("bnd"); // `>` would drop the exact 1.0 == 1.0 match
  });
});

// ── trigramConcepts result ordering (L197:33 — the whole outer comparator). Two
//    concepts with DIFFERENT scores, inserted NOT in score order and with an id
//    order that disagrees with score order, so every mutant of `b.score - a.score
//    || (id<id?-1:1)` — sum, `&&`, →true, →false, dropped `.sort`, undefined arrow
//    — misorders. Real output is score-descending regardless of insertion/id order.
describe("memory trigramConcepts — orders by score desc, id asc (L197:33 / :14 / :23)", () => {
  it("puts the higher-scoring concept first even when inserted last and id-greater", async () => {
    const store = createMemoryStore();
    await store.putConcept({ ...buildConcept({ name: "Photosynthetic" }), id: "a-weak" }); // score ~0.71, inserted first, id-least
    await store.putConcept({ ...buildConcept({ name: "Photosynthesis" }), id: "z-strong" }); // score 1.0, inserted last, id-greatest
    const out = await store.trigramConcepts("Photosynthesis", PUB, 0.3);
    expect(out.map((r) => r.concept.id)).toEqual(["z-strong", "a-weak"]); // score desc; every mutant yields a-weak first
  });

  it("breaks equal-score ties by id ascending (L197:55 →true / →false / >=)", async () => {
    const store = createMemoryStore();
    // three identical names → identical scores → the tie-break decides; insert scrambled
    await store.putConcept({ ...buildConcept({ name: "Photosynthesis" }), id: "c-bravo" });
    await store.putConcept({ ...buildConcept({ name: "Photosynthesis" }), id: "c-alpha" });
    await store.putConcept({ ...buildConcept({ name: "Photosynthesis" }), id: "c-charlie" });
    const out = await store.trigramConcepts("Photosynthesis", PUB, 0.3);
    expect(out.map((r) => r.concept.id)).toEqual(["c-alpha", "c-bravo", "c-charlie"]); // id asc, not insertion/reverse/desc
  });
});

// ── listSources ordering (L227:52 →true) — sorted by id ascending. The first pass
//    used two reverse-sorted ids where "always -1" (reverse) == sorted; three
//    scrambled ids expose it.
describe("memory listSources — id-ascending under scrambled insert (L227:52)", () => {
  const mkSource = (id: string): Source => ({ id, kind: "book", title: "T", publisher: "P", authority: "A", edition: null, publishedAt: null, uri: null, checksum: id, license: "L", licenseUrl: null, ingestedAt: new Date() });
  it("orders three scrambled sources ascending", async () => {
    const store = createMemoryStore();
    await store.putSource(mkSource("src-b"));
    await store.putSource(mkSource("src-a"));
    await store.putSource(mkSource("src-c"));
    expect((await store.listSources()).map((s) => s.id)).toEqual(["src-a", "src-b", "src-c"]); // reversing → src-c,src-a,src-b
  });
});

// ── searchChunks score value (L242:34 `/`→`*`) — score is hits / terms.length. One
//    hit of a two-term query is exactly 0.5; multiplication gives 2.
describe("memory searchChunks — score is the fraction of terms present (L242:34)", () => {
  const src: Source = { id: "src", kind: "book", title: "T", publisher: "P", authority: "A", edition: null, publishedAt: null, uri: null, checksum: "c", license: "L", licenseUrl: null, ingestedAt: new Date() };
  it("scores a one-of-two-term hit at exactly 0.5", async () => {
    const store = createMemoryStore();
    await store.putSource(src);
    await store.putSourceChunk({ id: "ch", sourceId: "src", locator: { page: 1, range: [0, 0] }, text: "a prime thing", ordinal: 0 });
    const out = await store.searchChunks("prime number"); // 2 terms, chunk holds only "prime"
    expect(out[0].score).toBe(0.5); // `*` would give 1 * 2 = 2
  });
});

// ── itemsForConcept link filter (L269:58 →true / L269:31 .filter dropped) — the
//    itemConcepts filter must discriminate on conceptId: a VISIBLE item linked to a
//    DIFFERENT concept must not appear. (First pass used a link whose item was
//    invisible/absent, so a match-all still filtered it out downstream.)
describe("memory itemsForConcept — the concept link filter discriminates (L269)", () => {
  const item = (id: string): AssessmentItem => ({ id, kind: "MCQ", prompt: "?", payload: {}, contextId: "ctx", scope: "PUBLIC" as Scope, trustLevel: "MACHINE_PROPOSED", version: 1, supersedes: null });
  it("excludes a public item linked to another concept", async () => {
    const store = createMemoryStore();
    await store.putAssessmentItem(item("keep"));
    await store.putAssessmentItem(item("other"));
    await store.putItemConcept({ itemId: "keep", conceptId: "C1", role: "PRIMARY", bloom: null });
    await store.putItemConcept({ itemId: "other", conceptId: "C2", role: "PRIMARY", bloom: null });
    expect((await store.itemsForConcept("C1", PUB, POLICIES.RND)).map((i) => i.id)).toEqual(["keep"]); // match-all leaks "other"
  });
});
