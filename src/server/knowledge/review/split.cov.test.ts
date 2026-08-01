import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { splitConcept } from "@/server/knowledge/review/split";
import type { ReviewEvent } from "@/server/knowledge/types";

/**
 * Branch- and mutation-focused coverage for splitConcept (§20.3).
 * Every guard, the scope default, the full event payload, and each side effect
 * (tombstone write, review-event append, closure clear) are pinned to exact values.
 */
describe("splitConcept (§20.3) — coverage", () => {
  const seedSource = async (store: ReturnType<typeof createMemoryStore>, name = "Energy") => {
    const source = buildConcept({ name });
    await store.putConcept(source);
    return source;
  };

  it("happy path — returns the exact SPLIT ReviewEvent and honors the supplied `now`", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store); // slug "energy"
    const kinetic = buildConcept({ name: "Kinetic energy" });
    const general = buildConcept({ name: "Energy (general)" });
    await store.putConcept(kinetic);
    await store.putConcept(general);

    const now = new Date("2026-01-02T03:04:05.678Z");
    const targetIds = [kinetic.id, general.id];
    const event = await splitConcept(
      store,
      { sourceId: source.id, targetIds, actorId: "rev-1" },
      now,
    );

    // every field of the event, pinned
    expect(typeof event.id).toBe("string");
    expect(event.id.length).toBeGreaterThan(0);
    expect(event.targetKind).toBe("Concept");
    expect(event.targetId).toBe(source.id);
    expect(event.decision).toBe("SPLIT");
    expect(event.fromTrust).toBeNull();
    expect(event.toTrust).toBeNull();
    expect(event.actorId).toBe("rev-1");
    expect(event.before).toEqual({ slug: "energy" });
    expect(event.after).toEqual({ splitInto: targetIds });
    expect(event.reason).toBe(`split into ${kinetic.id}, ${general.id}`);
    expect(event.batchId).toBeNull();
    expect(event.createdAt).toBe(now); // exact reference, not just equal
  });

  it("persists the tombstone with status SPLIT and splitInto = targets", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);
    const targetIds = ["A-x", "A-y"];

    await splitConcept(store, { sourceId: source.id, targetIds, actorId: "rev-1" });

    const tombstone = await store.getConcept(source.id, "PUBLIC");
    expect(tombstone).not.toBeNull();
    expect(tombstone!.status).toBe("SPLIT");
    expect(tombstone!.splitInto).toEqual(targetIds);
    expect(tombstone!.mergedInto).toBeNull();
    // identity is preserved through the tombstone (id + slug unchanged)
    expect(tombstone!.id).toBe(source.id);
    expect(tombstone!.slug).toBe(source.slug);
  });

  it("the source slug now resolves HONESTLY AMBIGUOUS to its targets", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);
    const targetIds = ["A-1kin", "A-2gen"];

    await splitConcept(store, { sourceId: source.id, targetIds, actorId: "rev-1" });

    expect(await store.resolveSlug("energy", "PUBLIC")).toEqual({
      kind: "ambiguous",
      candidates: targetIds,
    });
  });

  it("appends the returned event to the review log for the source", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);

    const event = await splitConcept(
      store,
      { sourceId: source.id, targetIds: ["A-1", "A-2"], actorId: "rev-1" },
    );

    const log = await store.reviewEventsFor("Concept", source.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toBe(event); // the SAME object that was returned
  });

  it("clears the derived closure cache on commit (§18)", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);
    await store.putClosure({
      conceptId: "A-other",
      releaseId: "2026-01-01-01",
      closure: ["A-dep"],
      computedAt: new Date(),
    });
    // sanity: the closure is present before the split
    expect(await store.getClosure("A-other", "2026-01-01-01")).not.toBeNull();

    await splitConcept(store, { sourceId: source.id, targetIds: ["A-1", "A-2"], actorId: "rev-1" });

    expect(await store.getClosure("A-other", "2026-01-01-01")).toBeNull();
  });

  it("defaults `now` to the current time when omitted", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);

    const before = Date.now();
    const event = await splitConcept(
      store,
      { sourceId: source.id, targetIds: ["A-1", "A-2"], actorId: "rev-1" },
    );
    const after = Date.now();

    expect(event.createdAt).toBeInstanceOf(Date);
    expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.createdAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("mints a distinct id per split", async () => {
    const store = createMemoryStore();
    const a = await seedSource(store, "Alpha");
    const b = await seedSource(store, "Beta");

    const e1 = await splitConcept(store, { sourceId: a.id, targetIds: ["A-1", "A-2"], actorId: "rev-1" });
    const e2 = await splitConcept(store, { sourceId: b.id, targetIds: ["A-3", "A-4"], actorId: "rev-1" });

    expect(e1.id).not.toBe(e2.id);
  });

  it("joins the reason with a comma-space over three targets", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);

    const event = await splitConcept(
      store,
      { sourceId: source.id, targetIds: ["A-1", "A-2", "A-3"], actorId: "rev-1" },
    );

    expect(event.reason).toBe("split into A-1, A-2, A-3");
    expect((event.after as { splitInto: string[] }).splitInto).toEqual(["A-1", "A-2", "A-3"]);
  });

  // ── guards ──

  it("rejects an empty actorId (never automatic — a human is required)", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);
    await expect(
      splitConcept(store, { sourceId: source.id, targetIds: ["A-1", "A-2"], actorId: "" }),
    ).rejects.toThrow("split requires a human actorId");
  });

  it("rejects a whitespace-only actorId (the guard trims)", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);
    await expect(
      splitConcept(store, { sourceId: source.id, targetIds: ["A-1", "A-2"], actorId: "   \t" }),
    ).rejects.toThrow("split requires a human actorId");
  });

  it("rejects fewer than two targets — zero targets", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);
    await expect(
      splitConcept(store, { sourceId: source.id, targetIds: [], actorId: "rev-1" }),
    ).rejects.toThrow("split needs at least two targets");
  });

  it("rejects fewer than two targets — one target (boundary)", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);
    await expect(
      splitConcept(store, { sourceId: source.id, targetIds: ["only-one"], actorId: "rev-1" }),
    ).rejects.toThrow("split needs at least two targets");
  });

  it("accepts exactly two targets (boundary — not one more)", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);
    const event = await splitConcept(
      store,
      { sourceId: source.id, targetIds: ["A-1", "A-2"], actorId: "rev-1" },
    );
    expect(event.decision).toBe("SPLIT");
  });

  it("throws with the source id when the source is not found", async () => {
    const store = createMemoryStore();
    await expect(
      splitConcept(store, { sourceId: "A-missing", targetIds: ["A-1", "A-2"], actorId: "rev-1" }),
    ).rejects.toThrow("split: source A-missing not found");
  });

  it("the actorId guard runs before the source lookup", async () => {
    const store = createMemoryStore();
    // no source seeded — but a blank actor should fail on the actor guard, not the lookup
    await expect(
      splitConcept(store, { sourceId: "A-missing", targetIds: ["A-1", "A-2"], actorId: " " }),
    ).rejects.toThrow("split requires a human actorId");
  });

  it("the target-count guard runs before the source lookup", async () => {
    const store = createMemoryStore();
    await expect(
      splitConcept(store, { sourceId: "A-missing", targetIds: ["A-1"], actorId: "rev-1" }),
    ).rejects.toThrow("split needs at least two targets");
  });

  // ── scope threading ──

  it("uses the supplied scope to find a tenant-scoped source", async () => {
    const store = createMemoryStore();
    const source = buildConcept({ name: "Tenant Energy", scope: "tenant:acme" });
    await store.putConcept(source);

    const event = await splitConcept(store, {
      sourceId: source.id,
      targetIds: ["A-1", "A-2"],
      actorId: "rev-1",
      scope: "tenant:acme",
    });
    expect(event.decision).toBe("SPLIT");

    const tombstone = await store.getConcept(source.id, "tenant:acme");
    expect(tombstone!.status).toBe("SPLIT");
  });

  it("defaults scope to PUBLIC — a tenant source is invisible without its scope", async () => {
    const store = createMemoryStore();
    const source = buildConcept({ name: "Tenant Energy", scope: "tenant:acme" });
    await store.putConcept(source);

    // no scope passed → defaults to PUBLIC → the tenant row is not visible → not found
    await expect(
      splitConcept(store, { sourceId: source.id, targetIds: ["A-1", "A-2"], actorId: "rev-1" }),
    ).rejects.toThrow(`split: source ${source.id} not found`);
  });

  it("does not write a tombstone or a review event when a guard rejects", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);

    await expect(
      splitConcept(store, { sourceId: source.id, targetIds: ["A-1"], actorId: "rev-1" }),
    ).rejects.toThrow();

    const untouched = await store.getConcept(source.id, "PUBLIC");
    expect(untouched!.status).toBe(source.status); // still DRAFT, not SPLIT
    expect(untouched!.splitInto).toEqual([]);
    expect(await store.reviewEventsFor("Concept", source.id)).toHaveLength(0);
  });

  it("event's after.splitInto reflects the exact target ids passed", async () => {
    const store = createMemoryStore();
    const source = await seedSource(store);
    const targetIds = ["A-red", "A-blue", "A-green"];

    const event: ReviewEvent = await splitConcept(
      store,
      { sourceId: source.id, targetIds, actorId: "rev-1" },
    );
    expect(event.after).toEqual({ splitInto: ["A-red", "A-blue", "A-green"] });
  });
});
