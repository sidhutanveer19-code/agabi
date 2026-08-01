import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { mergeConcepts } from "@/server/knowledge/review/merge";
import { splitConcept } from "@/server/knowledge/review/split";
import { resolve } from "@/server/knowledge/search";
import { POLICIES } from "@/server/knowledge/trust/policy";

describe("M6 merge / split (§20.3, ADR-10)", () => {
  it("merge — the loser's slug resolves to the winner forever", async () => {
    const store = createMemoryStore();
    const winner = buildConcept({ name: "Velocity" });
    const loser = buildConcept({ name: "Speed" });
    await store.putConcept(winner);
    await store.putConcept(loser);

    const event = await mergeConcepts(store, { loserId: loser.id, winnerId: winner.id, actorId: "rev-1" });
    expect(event.decision).toBe("MERGE");
    expect(await store.resolveSlug("speed", "PUBLIC")).toEqual({ kind: "concept", conceptId: winner.id });
    expect(await store.resolveSlug("velocity", "PUBLIC")).toEqual({ kind: "concept", conceptId: winner.id });
  });

  it("merge is never automatic — a human actorId is required (ADR-10)", async () => {
    const store = createMemoryStore();
    const a = buildConcept({ name: "A" }), b = buildConcept({ name: "B" });
    await store.putConcept(a);
    await store.putConcept(b);
    await expect(mergeConcepts(store, { loserId: a.id, winnerId: b.id, actorId: "  " })).rejects.toThrow(/human actorId/);
  });

  it("split — the source resolves HONESTLY AMBIGUOUS to its targets", async () => {
    const store = createMemoryStore();
    const source = buildConcept({ name: "Energy" });
    const kinetic = buildConcept({ name: "Kinetic energy" });
    const general = buildConcept({ name: "Energy (general)" });
    for (const c of [source, kinetic, general]) await store.putConcept(c);

    const event = await splitConcept(store, { sourceId: source.id, targetIds: [kinetic.id, general.id], actorId: "rev-1" });
    expect(event.decision).toBe("SPLIT");
    expect(await store.resolveSlug("energy", "PUBLIC")).toEqual({ kind: "ambiguous", candidates: [kinetic.id, general.id] });
  });

  it("split needs at least two targets", async () => {
    const store = createMemoryStore();
    const s = buildConcept({ name: "X" });
    await store.putConcept(s);
    await expect(splitConcept(store, { sourceId: s.id, targetIds: ["only-one"], actorId: "rev-1" })).rejects.toThrow(/two targets/);
  });
});

describe("M6 search rung 3 — trigram (§15)", () => {
  it("a typo that misses rungs 1–2 is caught by the trigram rung", async () => {
    const store = createMemoryStore();
    const c = buildConcept({ name: "Photosynthesis", slug: "photosynthesis" });
    await store.putConcept(c);

    // exact hit is rung 1
    const exact = await resolve(store, { text: "photosynthesis", trustPolicy: POLICIES.GENERAL_SCHOOL });
    expect(exact[0]).toMatchObject({ conceptId: c.id, rung: 1 });

    // a misspelling falls through to rung 3
    const fuzzy = await resolve(store, { text: "photosynthesus", trustPolicy: POLICIES.GENERAL_SCHOOL });
    expect(fuzzy[0]).toMatchObject({ conceptId: c.id, rung: 3 });
    expect(fuzzy[0].score).toBeGreaterThan(0.3);
  });
});
