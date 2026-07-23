import { describe, it, expect, beforeEach } from "vitest";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import { buildConcept, mergeTombstone, splitTombstone, rename } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
import { mintId } from "@/server/knowledge/ids";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type { Scope, TrustLevel, TrustPolicy } from "@/server/knowledge/types";

/**
 * The store conformance suite (S9, §29 `conformance`). ANY KnowledgeStore implementation
 * must pass it — that is what makes the interface the contract and Postgres just one
 * behind-the-seam impl. Runs against the in-memory store unconditionally; a live-DB impl
 * runs the identical suite (parity is the whole point).
 */
export function describeConformance(label: string, makeStore: () => KnowledgeStore, reset?: () => Promise<void>) {
  describe(`KnowledgeStore conformance — ${label}`, () => {
    let store: KnowledgeStore;
    // The memory store is a fresh object each run, so re-constructing it IS the reset. A
    // persistent store (Postgres) has nothing to reconstruct — knowledge is append-only (L5,
    // no delete path in the store itself), so the suite would accumulate across runs and the
    // empty-platform / unique-slug cases would see prior rows. The optional `reset` lets the
    // caller wipe between cases; the destructive SQL stays out of this module (kept in the
    // .test.ts, which is exempt from the no-delete invariant) so knowledge/ owns no delete path.
    beforeEach(async () => {
      if (reset) await reset();
      store = makeStore();
    });

    // empty-platform (§29, S10): every read is total on zero rows — no throw, no null-deref.
    it("empty-platform — all reads succeed on a fresh store", async () => {
      expect(await store.listConcepts("PUBLIC")).toEqual([]);
      expect(await store.getConcept("nope", "PUBLIC")).toBeNull();
      expect(await store.getContext("nope")).toBeNull();
      expect(await store.resolveSlug("nope", "PUBLIC")).toEqual({ kind: "none" });
      expect(await store.statementsForSubject("nope", "PUBLIC", POLICIES.RESEARCH)).toEqual([]);
      expect(await store.dependencyEdges()).toEqual([]);
      expect(await store.compositionEdges()).toEqual([]);
      expect(await store.reinforcementEdges()).toEqual([]);
      expect(await store.provenanceFor("nope")).toEqual([]);
    });

    it("concept round-trips and resolves by slug", async () => {
      const c = buildConcept({ name: "Chlorophyll" });
      await store.putConcept(c);
      expect(await store.getConcept(c.id, "PUBLIC")).toMatchObject({ id: c.id, slug: "chlorophyll" });
      expect(await store.resolveSlug("chlorophyll", "PUBLIC")).toEqual({ kind: "concept", conceptId: c.id });
    });

    // tenant-isolation (§29, S15): two tenants, zero cross-visibility; both see public.
    it("tenant-isolation — a tenant sees its own + public, never another tenant", async () => {
      const pub = buildConcept({ name: "Energy" });
      const a = buildConcept({ name: "A-secret", scope: "tenant:a" as Scope });
      const b = buildConcept({ name: "B-secret", scope: "tenant:b" as Scope });
      await store.putConcept(pub);
      await store.putConcept(a);
      await store.putConcept(b);

      const ids = (cs: { id: string }[]) => cs.map((c) => c.id).sort();
      expect(ids(await store.listConcepts("PUBLIC"))).toEqual([pub.id]);
      expect(ids(await store.listConcepts("tenant:a"))).toEqual([pub.id, a.id].sort());
      expect(ids(await store.listConcepts("tenant:b"))).toEqual([pub.id, b.id].sort());

      expect(await store.getConcept(a.id, "tenant:b")).toBeNull(); // no cross-tenant read
      expect(await store.getConcept(a.id, "tenant:a")).not.toBeNull();
      expect(await store.getConcept(a.id, "PUBLIC")).toBeNull();
      // slug resolution is scoped too — a tenant slug is invisible to another tenant
      expect(await store.resolveSlug("a-secret", "tenant:b")).toEqual({ kind: "none" });
      expect(await store.resolveSlug("a-secret", "tenant:a")).toEqual({ kind: "concept", conceptId: a.id });
    });

    // context-canonical (§29, C5): identical dimension sets hash to ONE row, order-independent.
    it("context-canonical — identical dimensions share a row; different ones do not", async () => {
      const c1 = await store.putContext({ jurisdiction: "IN", grade: "10" });
      const c2 = await store.putContext({ grade: "10", jurisdiction: "IN" }); // key order flipped
      const c3 = await store.putContext({ jurisdiction: "US", grade: "10" });
      expect(c2.id).toBe(c1.id);
      expect(c3.id).not.toBe(c1.id);
      expect(await store.getContext(c1.id)).toMatchObject({ id: c1.id });
    });

    // no-silent-uncertainty (§29, S3) + trust gating (§26.4): below refuseBelow is dropped,
    // below labelBelow is returned labelled, never bare.
    it("trust policy — refuses below the floor and labels the uncertain", async () => {
      const ctx = await store.putContext({ jurisdiction: "IN" });
      const put = (trust: TrustLevel) =>
        store.putStatement({
          ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "S", predicate: "p", objectId: "O" }, text: "written", contextId: ctx.id }),
          trustLevel: trust,
        });
      await put("MACHINE_PROPOSED");
      await put("AUTO_VALIDATED");
      await put("COMMUNITY_REVIEWED");

      // RESEARCH floor = AUTO_VALIDATED: the MACHINE_PROPOSED one is refused.
      const research = await store.statementsForSubject("S", "PUBLIC", POLICIES.RESEARCH);
      expect(research.map((s) => s.trustLevel).sort()).toEqual(["AUTO_VALIDATED", "COMMUNITY_REVIEWED"]);
      expect(research.every((s) => s.labelled === false)).toBe(true);

      // A policy that refuses below AUTO_VALIDATED but labels below COMMUNITY_REVIEWED:
      const mixed: TrustPolicy = { minimum: "COMMUNITY_REVIEWED", labelBelow: "COMMUNITY_REVIEWED", refuseBelow: "AUTO_VALIDATED" };
      const rows = await store.statementsForSubject("S", "PUBLIC", mixed);
      const byTrust = Object.fromEntries(rows.map((s) => [s.trustLevel, s.labelled]));
      expect(byTrust["MACHINE_PROPOSED"]).toBeUndefined(); // refused
      expect(byTrust["AUTO_VALIDATED"]).toBe(true); // labelled — uncertain, never bare
      expect(byTrust["COMMUNITY_REVIEWED"]).toBe(false); // plain
    });

    // §26.5 — a disputed statement is never served, at ANY trust level or policy.
    it("disputed statements are never served, even under the most permissive policy", async () => {
      const ctx = await store.putContext({ jurisdiction: "IN" });
      const base = buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "D", predicate: "p", objectId: "O" }, text: "written", contextId: ctx.id });
      await store.putStatement({ ...base, trustLevel: "AGABI_CANONICAL", disputed: true, disputeReason: "contested", disputedAt: new Date(), priorTrustLevel: "AGABI_CANONICAL" });
      // RND admits MACHINE_PROPOSED and up — yet disputed is checked BEFORE the level.
      expect(await store.statementsForSubject("D", "PUBLIC", POLICIES.RND)).toEqual([]);
      expect(await store.getStatement(base.id, "PUBLIC", POLICIES.RND)).toBeNull();
    });

    // §18A.4 — resolution follows tombstones: rename→FORMER_NAME, merge→winner, split→ambiguous.
    it("slug resolution follows rename, merge and split tombstones", async () => {
      // rename: old slug still resolves via FORMER_NAME alias
      const c = buildConcept({ name: "Colour" });
      await store.putConcept(c);
      const renamed = rename(c, "Color");
      await store.putConcept(renamed.concept);
      await store.putConceptAlias(renamed.formerAlias);
      expect(await store.resolveSlug("color", "PUBLIC")).toEqual({ kind: "concept", conceptId: c.id });
      expect(await store.resolveSlug("colour", "PUBLIC")).toEqual({ kind: "concept", conceptId: c.id });

      // merge: loser resolves forever to the winner
      const winner = buildConcept({ name: "Velocity" });
      const loser = buildConcept({ name: "Speed" });
      await store.putConcept(winner);
      await store.putConcept(loser);
      const merged = mergeTombstone(loser, winner.id);
      await store.putConcept(merged.concept);
      await store.putConceptAlias(merged.alias);
      expect(await store.resolveSlug("speed", "PUBLIC")).toEqual({ kind: "concept", conceptId: winner.id });

      // split: source resolves honestly-ambiguous
      const source = buildConcept({ name: "Energy-amb" });
      await store.putConcept(source);
      const split = splitTombstone(source, ["k1", "k2"]);
      await store.putConcept(split);
      expect(await store.resolveSlug("energy-amb", "PUBLIC")).toEqual({ kind: "ambiguous", candidates: ["k1", "k2"] });
    });

    // full write surface (§29 conformance = the WHOLE interface, S9): every remaining write
    // method must persist and read back through the engine. Concepts were the only re-put-by-id
    // case (fixed to upsert); the rest are append-only inserts, but "read the code" is weaker
    // than "ran it against a real database" — this drives each one and reads it back so the
    // Postgres impl is proven, not assumed. Backs the live paths of M3/M4/M7/M9.
    it("full write surface — every remaining write method persists and reads back", async () => {
      const ctx = await store.putContext({ subject: "biology" });
      const c = buildConcept({ name: "Cell" });
      await store.putConcept(c);

      // statement + provenance
      const s = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: c.id, predicate: "has", objectId: "O" }, text: "a cell has a membrane", contextId: ctx.id }), subjectId: c.id, trustLevel: "MACHINE_PROPOSED" as TrustLevel };
      await store.putStatement(s);
      await store.putProvenance({ statementId: s.id, sourceId: "src1", chunkId: "ch1", locator: {}, quote: "membrane", extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date() });
      expect(await store.provenanceFor(s.id)).toHaveLength(1);

      // concept tag — insert-only (no read method on the interface)
      await store.putConceptTag({ conceptId: c.id, namespace: "cbse", value: "class10" });

      // the three graphs
      await store.putDependencyEdge({ fromId: c.id, toId: "dep", strength: 1, contextId: null, version: 1, supersedes: null });
      await store.putCompositionEdge({ partId: "part", wholeId: c.id, ordinal: 0, version: 1 });
      await store.putReinforcementEdge({ fromId: c.id, toId: "rein", type: "REINFORCES", strength: 1, earned: false, contextId: null, version: 1 });
      expect((await store.dependencyEdges()).some((e) => e.fromId === c.id)).toBe(true);
      expect((await store.compositionEdges()).some((e) => e.wholeId === c.id)).toBe(true);
      expect((await store.reinforcementEdges()).some((e) => e.fromId === c.id)).toBe(true);

      // review event (M3) → reviewEventsFor
      await store.putReviewEvent({ id: mintId(), targetKind: "Statement", targetId: s.id, decision: "APPROVE", fromTrust: null, toTrust: null, actorId: "human", before: null, after: null, reason: null, batchId: null, createdAt: new Date() });
      expect(await store.reviewEventsFor("Statement", s.id)).toHaveLength(1);

      // teaching asset (M7) → assetsForConcept, trust-gated
      await store.putTeachingAsset({ id: mintId(), kind: "MISCONCEPTION", conceptId: c.id, statementId: null, payload: { text: "confuses cell with atom" }, contextId: ctx.id, trustLevel: "MACHINE_PROPOSED", scope: "PUBLIC" as Scope, version: 1, supersedes: null });
      expect(await store.assetsForConcept(c.id, "PUBLIC", POLICIES.RND)).toHaveLength(1);

      // assessment item + item-concept (M9) → itemsForConcept
      const itemId = mintId();
      await store.putAssessmentItem({ id: itemId, kind: "MCQ", prompt: "What bounds a cell?", payload: { options: [] }, contextId: ctx.id, scope: "PUBLIC" as Scope, trustLevel: "MACHINE_PROPOSED", version: 1, supersedes: null });
      await store.putItemConcept({ itemId, conceptId: c.id, role: "PRIMARY", bloom: null });
      expect(await store.itemsForConcept(c.id, "PUBLIC", POLICIES.RND)).toHaveLength(1);

      // program / node / mapping (M4, the curriculum mapping layer) → mappingsForConcept + mappingsUnderNode
      const prog = { id: mintId(), slug: "cbse-x", name: "CBSE X", kind: "SCHOOL_BOARD", authority: "CBSE", jurisdiction: "IN", scope: "PUBLIC" as Scope, version: "2026" };
      await store.putProgram(prog);
      const nodeId = mintId();
      await store.putProgramNode({ id: nodeId, programId: prog.id, parentId: null, nodeKind: "TOPIC", name: "Cells", ordinal: 0, code: null });
      await store.putMapping({ programNodeId: nodeId, conceptId: c.id, depth: "INTRODUCE", ordinal: 0, examWeight: null, required: true });
      expect(await store.mappingsForConcept(c.id)).toHaveLength(1);
      expect(await store.mappingsUnderNode(nodeId)).toHaveLength(1);

      // release + members (M9 replay, §19) → releaseMembersOf
      const rel = { id: "2026-07-23-01", label: "r1", createdAt: new Date(), frozen: false };
      await store.putRelease(rel, [{ releaseId: rel.id, kind: "Statement", entityId: s.id }]);
      expect(await store.releaseMembersOf(rel.id)).toHaveLength(1);

      // derived closure cache (M4, ADR-11) → get, then clear-all
      await store.putClosure({ conceptId: c.id, releaseId: rel.id, closure: ["a", "b"], computedAt: new Date() });
      expect(await store.getClosure(c.id, rel.id)).toMatchObject({ closure: ["a", "b"] });
      await store.clearClosures();
      expect(await store.getClosure(c.id, rel.id)).toBeNull();

      // commitReview (M3) — the ONE atomic trust writer: promote above the machine floor
      await store.commitReview(
        { id: mintId(), targetKind: "Statement", targetId: s.id, decision: "PROMOTE", fromTrust: "MACHINE_PROPOSED", toTrust: "COMMUNITY_REVIEWED", actorId: "human", before: null, after: null, reason: null, batchId: null, createdAt: new Date() },
        { targetKind: "Statement", targetId: s.id, trustLevel: "COMMUNITY_REVIEWED" },
      );
      expect((await store.getStatementRaw(s.id))?.trustLevel).toBe("COMMUNITY_REVIEWED");
    });
  });
}
