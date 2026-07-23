import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
import { POLICIES } from "@/server/knowledge/trust/policy";
import { detectDuplicates } from "@/server/knowledge/detect/duplicates";
import { missingConcepts } from "@/server/knowledge/detect/missing";

describe("detectors (W7) — reuse trigram + coverage, never a new algorithm", () => {
  it("surfaces near-duplicate concepts via trigram similarity (never auto-merges)", async () => {
    const store = createMemoryStore();
    const a = buildConcept({ name: "Chlorophyll" });
    const b = buildConcept({ name: "Chlorophyl" }); // near-duplicate (typo)
    const far = buildConcept({ name: "Mitochondria" });
    await store.putConcept(a);
    await store.putConcept(b);
    await store.putConcept(far);

    const dups = await detectDuplicates(store, "PUBLIC", 0.5);
    expect(dups.length).toBeGreaterThanOrEqual(1);
    const ids = [a.id, b.id].sort();
    expect(dups.some((p) => p.a === ids[0] && p.b === ids[1])).toBe(true);
    expect(dups.every((p) => p.a !== far.id && p.b !== far.id)).toBe(true); // the far concept isn't paired
  });

  it("missing-concept detector returns the coverage orphans", async () => {
    const store = createMemoryStore();
    const covered = buildConcept({ name: "Cell" });
    const orphan = buildConcept({ name: "Orphan" });
    await store.putConcept(covered);
    await store.putConcept(orphan);
    const ctx = await store.putContext({});
    const s = buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: covered.id, predicate: "has", objectLit: "x" }, text: "t", contextId: ctx.id });
    await store.putStatement(s);

    expect(await missingConcepts(store, "PUBLIC", POLICIES.RND)).toEqual([orphan.id]);
  });
});
