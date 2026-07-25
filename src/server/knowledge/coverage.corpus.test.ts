import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
import { coverageReport, corpusCoverage } from "@/server/knowledge/coverage";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type { Source, SourceChunk } from "@/server/knowledge/types";

function source(id: string, uri: string | null): Source {
  return {
    id,
    kind: "book",
    title: id,
    publisher: "pub",
    authority: "gov",
    edition: null,
    publishedAt: null,
    uri,
    checksum: `sum-${id}`,
    license: "CC",
    licenseUrl: null,
    ingestedAt: new Date(0),
  };
}

function chunk(id: string, sourceId: string): SourceChunk {
  return { id, sourceId, locator: { page: 1, range: [0, 1] }, text: "t", ordinal: 0 };
}

async function prov(store: ReturnType<typeof createMemoryStore>, statementId: string, chunkId: string) {
  await store.putProvenance({
    statementId,
    sourceId: "src",
    chunkId,
    locator: {},
    quote: "q",
    extractorVersion: "1",
    promptVersion: "1",
    modelId: "m",
    extractedAt: new Date(0),
  });
}

describe("corpusCoverage (breadth) — sources + chunks from store alone", () => {
  it("empty store, no declaredRefs → fully zeroed (den=0 guards)", async () => {
    const r = await corpusCoverage(createMemoryStore());
    expect(r).toEqual({
      declaredSources: 0,
      ingestedSources: 0,
      missingSources: [],
      chunks: 0,
      productiveChunks: 0,
      barrenChunks: [],
      sourceCoverage: 0,
      chunkCoverage: 0,
    });
  });

  it("no declaredRefs → ingestedSources counts present source rows, sourceCoverage stays 0", async () => {
    const store = createMemoryStore();
    await store.putSource(source("a", "root/chapters/math.md"));
    await store.putSource(source("b", null));
    const r = await corpusCoverage(store); // declaredRefs defaults to []
    expect(r.declaredSources).toBe(0);
    expect(r.ingestedSources).toBe(2); // present.size branch
    expect(r.missingSources).toEqual([]);
    expect(r.sourceCoverage).toBe(0); // declaredRefs.length falsy → literal 0, not a rate
  });

  it("declaredRefs matched by URI SUFFIX; missing refs sorted; null uri never matches", async () => {
    const store = createMemoryStore();
    await store.putSource(source("a", "dataset/root/chapters/math-real-numbers.md"));
    await store.putSource(source("b", null)); // null → "" → matches nothing
    // "math-real-numbers.md" is a suffix of source a's uri → present.
    // The other two refs have no matching source → missing, and must come back SORTED.
    const r = await corpusCoverage(store, [
      "chapters/math-real-numbers.md",
      "chapters/zzz-last.md",
      "chapters/aaa-first.md",
    ]);
    expect(r.declaredSources).toBe(3);
    expect(r.missingSources).toEqual(["chapters/aaa-first.md", "chapters/zzz-last.md"]);
    expect(r.ingestedSources).toBe(1); // 3 declared − 2 missing
    expect(r.sourceCoverage).toBeCloseTo(1 / 3, 12);
  });

  it("barren vs productive chunks: only chunks with a provenance row are productive; barren ids sorted", async () => {
    const store = createMemoryStore();
    await store.putSource(source("src", "s"));
    await store.putSourceChunk(chunk("c-productive", "src"));
    await store.putSourceChunk(chunk("z-barren", "src"));
    await store.putSourceChunk(chunk("a-barren", "src"));
    // one provenance row pointing at c-productive only
    await prov(store, "stmt-1", "c-productive");
    const r = await corpusCoverage(store);
    expect(r.chunks).toBe(3);
    expect(r.productiveChunks).toBe(1);
    expect(r.barrenChunks).toEqual(["a-barren", "z-barren"]); // sorted, c-productive excluded
    expect(r.chunkCoverage).toBeCloseTo(1 / 3, 12);
  });

  it("every chunk productive → no barren, chunkCoverage 1", async () => {
    const store = createMemoryStore();
    await store.putSourceChunk(chunk("c1", "src"));
    await store.putSourceChunk(chunk("c2", "src"));
    await prov(store, "s1", "c1");
    await prov(store, "s2", "c2");
    const r = await corpusCoverage(store);
    expect(r.barrenChunks).toEqual([]);
    expect(r.productiveChunks).toBe(2);
    expect(r.chunkCoverage).toBe(1);
  });
});

describe("coverageReport — adversarial grounding / orphan branches", () => {
  async function seedMixed() {
    const store = createMemoryStore();
    const covered = buildConcept({ name: "Grounded" });
    const partly = buildConcept({ name: "Ungrounded" });
    const orphanB = buildConcept({ name: "OrphanB" });
    const orphanA = buildConcept({ name: "OrphanA" });
    for (const c of [covered, partly, orphanB, orphanA]) await store.putConcept(c);
    const ctx = await store.putContext({});
    const grounded = buildStatement({
      kind: "FACT",
      form: "SPO",
      structure: { subjectId: covered.id, predicate: "is", objectLit: "x" },
      text: "own words one",
      contextId: ctx.id,
    });
    const ungrounded = buildStatement({
      kind: "FACT",
      form: "SPO",
      structure: { subjectId: partly.id, predicate: "is", objectLit: "y" },
      text: "own words two",
      contextId: ctx.id,
    });
    await store.putStatement(grounded);
    await store.putStatement(ungrounded);
    await prov(store, grounded.id, "ch"); // only the first statement gets provenance
    return { store, grounded, ungrounded, orphanA, orphanB };
  }

  it("splits grounded vs ungrounded statements and sorts orphan ids", async () => {
    const { store, grounded, ungrounded, orphanA, orphanB } = await seedMixed();
    const r = await coverageReport(store, "PUBLIC", POLICIES.RND);
    expect(r.concepts).toBe(4);
    expect(r.coveredConcepts).toBe(2); // Grounded + Ungrounded have subject-statements
    expect(r.orphanConcepts).toEqual([orphanA.id, orphanB.id].sort()); // sorted
    expect(r.statements).toBe(2);
    expect(r.groundedStatements).toBe(1);
    expect(r.ungroundedStatements).toEqual([ungrounded.id]);
    // grounded id is NOT in the ungrounded list
    expect(r.ungroundedStatements).not.toContain(grounded.id);
    expect(r.coverageRate).toBe(0.5); // 2/4
    expect(r.groundingRate).toBe(0.5); // 1/2
  });
});
