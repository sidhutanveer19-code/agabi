import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
import { coverageReport } from "@/server/knowledge/coverage";
import { POLICIES } from "@/server/knowledge/trust/policy";

async function seed() {
  const store = createMemoryStore();
  const covered = buildConcept({ name: "Chlorophyll" });
  const orphan = buildConcept({ name: "Orphan" });
  await store.putConcept(covered);
  await store.putConcept(orphan);
  const ctx = await store.putContext({});
  const s = buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: covered.id, predicate: "absorbs", objectLit: "light" }, text: "written in our own words", contextId: ctx.id });
  await store.putStatement(s);
  await store.putProvenance({ statementId: s.id, sourceId: "src", chunkId: "ch", locator: {}, quote: "q", extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date() });
  return { store, orphan };
}

describe("coverage (W3) — derived, deterministic, rebuildable (ADR-11)", () => {
  it("reports concept coverage + grounding from store state", async () => {
    const { store, orphan } = await seed();
    const r = await coverageReport(store, "PUBLIC", POLICIES.RND);
    expect(r.concepts).toBe(2);
    expect(r.coveredConcepts).toBe(1);
    expect(r.orphanConcepts).toEqual([orphan.id]);
    expect(r.statements).toBe(1);
    expect(r.groundedStatements).toBe(1);
    expect(r.ungroundedStatements).toEqual([]);
    expect(r.coverageRate).toBe(0.5);
    expect(r.groundingRate).toBe(1);
  });

  it("is rebuildable byte-identical — same store → same report", async () => {
    const { store } = await seed();
    const first = await coverageReport(store, "PUBLIC", POLICIES.RND);
    const again = await coverageReport(store, "PUBLIC", POLICIES.RND);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
  });

  it("empty platform → zeroed report, no throw (§P7)", async () => {
    const r = await coverageReport(createMemoryStore(), "PUBLIC", POLICIES.RND);
    expect(r).toMatchObject({ concepts: 0, coveredConcepts: 0, statements: 0, coverageRate: 0, groundingRate: 0 });
  });
});
