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
