import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildPendingQueue, revalidate } from "@/server/knowledge/review/pending";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
import { SCREEN_SIZE, buildScreens } from "@/server/knowledge/review/batch";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";

const CHUNK = "Prime factorisation expresses a number as a product of primes. Every composite number factorises uniquely.";

async function seed(store: KnowledgeStore, opts: { withChunk?: boolean; withProvenance?: boolean; subject?: boolean } = {}) {
  const { withChunk = true, withProvenance = true, subject = true } = opts;
  const ctx = await store.putContext({});
  const c = buildConcept({ name: "Prime factorisation" });
  await store.putConcept(c);
  await store.putSource({ id: "src1", kind: "book", title: "Maths", publisher: "p", authority: "a", edition: null, publishedAt: null, uri: null, checksum: "x", license: "CC0-1.0", licenseUrl: null, ingestedAt: new Date() });
  if (withChunk) await store.putSourceChunk({ id: "ch1", sourceId: "src1", locator: { page: 1, range: [0, CHUNK.length] }, text: CHUNK, ordinal: 0 });

  const s = buildStatement({
    kind: "DEFINITION",
    form: "DEFINITIONAL",
    structure: { subject: "Prime factorisation" },
    text: "A number can be written as primes multiplied together.",
    contextId: ctx.id,
    ...(subject ? { subjectId: c.id } : {}),
  });
  await store.putStatement(s);
  if (withProvenance) {
    await store.putProvenance({
      statementId: s.id, sourceId: "src1", chunkId: "ch1", locator: {},
      quote: "Prime factorisation expresses a number as a product of primes",
      extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date(),
    });
  }
  return { conceptId: c.id, statementId: s.id };
}

describe("review pending queue (A3) — store → reviewable proposals", () => {
  it("turns pending statements into proposals carrying the stored passage and re-run gates", async () => {
    const store = createMemoryStore();
    const { statementId } = await seed(store);

    const q = await buildPendingQueue(store);
    expect(q.totals).toEqual({ pending: 1, reviewable: 1, unreviewable: 0 });

    const p = q.proposals[0];
    expect(p.targetId).toBe(statementId);
    expect(p.chunkText).toBe(CHUNK); // the passage comes from the store, not from memory of the run
    expect(p.validation.find((v) => v.validator === "V3")?.outcome).toBe("pass");
    expect(p.degraded).toBeUndefined();
    expect(buildScreens(q.proposals.map((x) => ({ targetKind: x.targetKind, targetId: x.targetId, statement: { form: x.statement.form, kind: x.statement.kind, text: x.statement.text, quote: x.quote, structure: {} }, chunkText: x.chunkText, validation: x.validation })))[0].proposals.length).toBeLessThanOrEqual(SCREEN_SIZE);
  });

  // M0a — the regression this file exists to prevent recurring. Once ingest started producing
  // AUTO_VALIDATED, an exact-equality filter on MACHINE_PROPOSED meant `review:export` showed ONLY
  // the statements that FAILED validation; every clean one was invisible to the reviewer and
  // unservable by any learner policy.
  it("queues BOTH machine levels — a clean AUTO_VALIDATED statement is not hidden from review", async () => {
    const store = createMemoryStore();
    const { statementId: proposed, conceptId } = await seed(store);

    // a second statement that passed every gate, i.e. what ingest now produces for good input
    const ctx = await store.putContext({});
    const clean = buildStatement({
      kind: "FACT", form: "QUANTIFIED", structure: { subject: "Prime factorisation" },
      text: "There are infinitely many primes.", contextId: ctx.id, subjectId: conceptId,
      trustLevel: "AUTO_VALIDATED", validationMethods: ["V3", "V4", "V5"], independentSourceCount: 1,
    });
    await store.putStatement(clean);
    await store.putProvenance({
      statementId: clean.id, sourceId: "src1", chunkId: "ch1", locator: {},
      quote: "Every composite number factorises", extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date(),
    });

    const q = await buildPendingQueue(store);
    expect(q.proposals.map((p) => p.targetId).sort()).toEqual([proposed, clean.id].sort());
    expect(q.totals).toEqual({ pending: 2, reviewable: 2, unreviewable: 0 });
    expect(q.proposals.every((p) => p.degraded === undefined)).toBe(true); // both carry a subject

    // the exact-level filter is still available, but only when a caller opts in
    const onlyClean = await buildPendingQueue(store, { trustLevel: "AUTO_VALIDATED" });
    expect(onlyClean.proposals.map((p) => p.targetId)).toEqual([clean.id]);
  });

  it("a human-reviewed statement has left the queue — it is no longer pending", async () => {
    const store = createMemoryStore();
    const { statementId } = await seed(store);
    const raw = await store.getStatementRaw(statementId);
    if (!raw) throw new Error("seed failed");
    await store.putStatement({ ...raw, trustLevel: "COMMUNITY_REVIEWED" });

    expect((await buildPendingQueue(store)).totals.pending).toBe(0);
  });

  it("lists a statement whose chunk was never stored as UNREVIEWABLE with the reason (R1)", async () => {
    const store = createMemoryStore();
    await seed(store, { withChunk: false }); // the pre-A2 shape: provenance points at nothing

    const q = await buildPendingQueue(store);
    expect(q.totals).toEqual({ pending: 1, reviewable: 0, unreviewable: 1 });
    expect(q.unreviewable[0].reason).toContain("not in the store");
  });

  it("lists a statement with no provenance as UNREVIEWABLE rather than dropping it (R1)", async () => {
    const store = createMemoryStore();
    await seed(store, { withProvenance: false });

    const q = await buildPendingQueue(store);
    expect(q.totals.unreviewable).toBe(1);
    expect(q.unreviewable[0].reason).toContain("no provenance");
  });

  it("still surfaces a subject-less statement, flagged degraded — invisible to a concept walk otherwise", async () => {
    const store = createMemoryStore();
    await seed(store, { subject: false });

    const q = await buildPendingQueue(store);
    expect(q.totals.reviewable).toBe(1);
    expect(q.proposals[0].degraded).toContain("no subject concept");
  });

  it("re-runs grounding against the stored chunk — a quote that no longer grounds is flagged", () => {
    const stmt = buildStatement({ kind: "FACT", form: "SPO", structure: {}, text: "own words", contextId: "ctx" });
    expect(revalidate(stmt, "a phrase that is absent", CHUNK).find((v) => v.validator === "V3")?.reason).toBe("QUOTE_NOT_IN_SOURCE");
  });
});
