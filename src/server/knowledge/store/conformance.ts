import { describe, it, expect, beforeEach } from "vitest";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import { buildConcept, mergeTombstone, splitTombstone, rename } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
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
  });
}
