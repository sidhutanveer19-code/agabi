import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { mergeConcepts } from "@/server/knowledge/review/merge";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { Concept, ReadScope } from "@/server/knowledge/types";

/**
 * §H1 unit coverage for review/merge.ts (§20.3, ADR-10). Every branch of `mergeConcepts` is
 * exercised against the REAL in-memory reference store (fake only at the I/O edge, §H1.7): the
 * human-actor guard (both throw sides + ordering), the `scope ?? "PUBLIC"` default vs an explicit
 * tenant scope, the loser/winner not-found throws, the full non-destructive tombstone + FORMER_NAME
 * alias, exact ReviewEvent field values, event persistence, closure clearing, and the `now` default.
 */

const MERGED = "MERGED";

/** Seed a winner ("Velocity") and loser ("Speed") into a fresh store at `scope`. */
async function seed(scope: Concept["scope"] = "PUBLIC"): Promise<{
  store: KnowledgeStore;
  winner: Concept;
  loser: Concept;
}> {
  const store = createMemoryStore();
  const winner = buildConcept({ name: "Velocity", scope });
  const loser = buildConcept({ name: "Speed", scope });
  await store.putConcept(winner);
  await store.putConcept(loser);
  return { store, winner, loser };
}

describe("mergeConcepts — happy path (§20.3, ADR-10)", () => {
  it("returns a MERGE ReviewEvent with every field set exactly", async () => {
    const { store, winner, loser } = await seed();
    const now = new Date("2026-07-27T10:00:00.000Z");

    const event = await mergeConcepts(
      store,
      { loserId: loser.id, winnerId: winner.id, actorId: "rev-1" },
      now,
    );

    expect(event.targetKind).toBe("Concept");
    expect(event.targetId).toBe(loser.id); // the LOSER is the target, not the winner
    expect(event.decision).toBe("MERGE");
    expect(event.fromTrust).toBeNull();
    expect(event.toTrust).toBeNull();
    expect(event.actorId).toBe("rev-1");
    expect(event.before).toEqual({ slug: "speed" });
    expect(event.after).toEqual({ mergedInto: winner.id });
    expect(event.reason).toBe(`merged into ${winner.id}`);
    expect(event.batchId).toBeNull();
    expect(event.createdAt).toBe(now); // the provided clock is used verbatim
    // id is minted in-process (A-1): 9 base36 chars + 16 hex, 25 chars total, opaque.
    expect(event.id).toMatch(/^[0-9a-z]{25}$/);
  });

  it("tombstones the loser row NON-DESTRUCTIVELY (status MERGED, mergedInto winner, rest preserved)", async () => {
    const { store, winner, loser } = await seed();

    await mergeConcepts(store, { loserId: loser.id, winnerId: winner.id, actorId: "rev-1" });

    const stored = await store.getConcept(loser.id, "PUBLIC");
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe(MERGED);
    expect(stored!.mergedInto).toBe(winner.id);
    // identity + everything else untouched — merge overwrites only status + mergedInto.
    expect(stored!.id).toBe(loser.id);
    expect(stored!.slug).toBe("speed");
    expect(stored!.name).toBe("Speed");
    expect(stored!.splitInto).toEqual([]);
  });

  it("keeps the loser slug as a FORMER_NAME alias so it resolves to the winner forever", async () => {
    const { store, winner, loser } = await seed();

    await mergeConcepts(store, { loserId: loser.id, winnerId: winner.id, actorId: "rev-1" });

    // the alias row itself points the old slug at the winner
    const byAlias = await store.conceptsByAlias("speed", "PUBLIC");
    expect(byAlias.map((c) => c.id)).toEqual([winner.id]);
    // and slug resolution follows it to the winner (loser slug AND winner slug both land on winner)
    expect(await store.resolveSlug("speed", "PUBLIC")).toEqual({ kind: "concept", conceptId: winner.id });
    expect(await store.resolveSlug("velocity", "PUBLIC")).toEqual({ kind: "concept", conceptId: winner.id });
  });

  it("persists the event under the loser's id, and NOT under the winner's", async () => {
    const { store, winner, loser } = await seed();

    const event = await mergeConcepts(store, { loserId: loser.id, winnerId: winner.id, actorId: "rev-1" });

    const onLoser = await store.reviewEventsFor("Concept", loser.id);
    expect(onLoser).toHaveLength(1);
    expect(onLoser[0].id).toBe(event.id);
    expect(onLoser[0].decision).toBe("MERGE");
    // the event targets the loser, so nothing is filed under the winner
    expect(await store.reviewEventsFor("Concept", winner.id)).toHaveLength(0);
  });

  it("clears the closure cache because the graph changed (§18)", async () => {
    const { store, winner, loser } = await seed();
    const releaseId = "2026-01-01-01";
    await store.putClosure({ conceptId: winner.id, releaseId, closure: [loser.id], computedAt: new Date() });
    expect(await store.getClosure(winner.id, releaseId)).not.toBeNull(); // sanity: it is cached

    await mergeConcepts(store, { loserId: loser.id, winnerId: winner.id, actorId: "rev-1" });

    expect(await store.getClosure(winner.id, releaseId)).toBeNull(); // wiped by clearClosures()
  });

  it("stamps a fresh Date when `now` is omitted (default parameter)", async () => {
    const { store, winner, loser } = await seed();
    const before = Date.now();

    const event = await mergeConcepts(store, { loserId: loser.id, winnerId: winner.id, actorId: "rev-1" });

    const after = Date.now();
    expect(event.createdAt).toBeInstanceOf(Date);
    expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.createdAt.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("mergeConcepts — scope resolution (§23)", () => {
  it("defaults to PUBLIC when no scope is given — tenant-only concepts are invisible → throws", async () => {
    const { store, winner, loser } = await seed("tenant:acme");

    // no scope passed → reads at PUBLIC → the tenant loser is not found
    await expect(
      mergeConcepts(store, { loserId: loser.id, winnerId: winner.id, actorId: "rev-1" }),
    ).rejects.toThrow(`merge: loser ${loser.id} not found`);
  });

  it("uses an explicit tenant scope for BOTH reads, so tenant concepts merge", async () => {
    const scope: ReadScope = "tenant:acme";
    const { store, winner, loser } = await seed("tenant:acme");

    const event = await mergeConcepts(
      store,
      { loserId: loser.id, winnerId: winner.id, actorId: "rev-1", scope },
    );

    expect(event.decision).toBe("MERGE");
    const stored = await store.getConcept(loser.id, scope);
    expect(stored!.status).toBe(MERGED);
    expect(stored!.mergedInto).toBe(winner.id);
    expect(await store.resolveSlug("speed", scope)).toEqual({ kind: "concept", conceptId: winner.id });
  });
});

describe("mergeConcepts — not-found guards", () => {
  it("throws naming the loser id when the loser is missing", async () => {
    const store = createMemoryStore();
    await store.putConcept(buildConcept({ name: "Velocity" })); // winner exists
    await expect(
      mergeConcepts(store, { loserId: "ghost-loser", winnerId: "anything", actorId: "rev-1" }),
    ).rejects.toThrow("merge: loser ghost-loser not found");
  });

  it("throws naming the winner id when only the winner is missing", async () => {
    const store = createMemoryStore();
    const loser = buildConcept({ name: "Speed" });
    await store.putConcept(loser); // loser exists, winner does not
    await expect(
      mergeConcepts(store, { loserId: loser.id, winnerId: "ghost-winner", actorId: "rev-1" }),
    ).rejects.toThrow("merge: winner ghost-winner not found");
  });
});

describe("mergeConcepts — human-actor guard (ADR-10, §26.2)", () => {
  it("refuses a blank actor BEFORE reading anything (guard runs first)", async () => {
    const store = createMemoryStore();
    // ids do not exist: if the not-found check ran first this would throw 'not found' instead.
    await expect(
      mergeConcepts(store, { loserId: "x", winnerId: "y", actorId: "   " }),
    ).rejects.toThrow(/human actorId/);
  });

  it("refuses a machine actor (system: prefix) and writes NOTHING", async () => {
    const { store, winner, loser } = await seed();

    await expect(
      mergeConcepts(store, { loserId: loser.id, winnerId: winner.id, actorId: "system:ingest" }),
    ).rejects.toThrow(/human actorId/);

    // no tombstone, no event — the guard short-circuits every side effect
    expect((await store.getConcept(loser.id, "PUBLIC"))!.status).toBe("DRAFT");
    expect(await store.reviewEventsFor("Concept", loser.id)).toHaveLength(0);
  });
});
