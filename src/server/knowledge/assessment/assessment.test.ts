import { describe, it, expect } from "vitest";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildItem, diagnosedMisconception } from "@/server/knowledge/assessment/item";
import { validateItemPayload, classifyByOutcome, ITEM_KINDS } from "@/server/knowledge/assessment/registry";
import { replayLesson } from "@/server/knowledge/replay";
import { buildRelease, supersede } from "@/server/knowledge/version";
import { buildStatement } from "@/server/knowledge/statement";
import { POLICIES } from "@/server/knowledge/trust/policy";

describe("M9 assessment (§10) + replay (§19)", () => {
  describe("item validation", () => {
    it("MCQ needs at least two options and exactly one correct", () => {
      expect(validateItemPayload("MCQ", { options: [{ text: "a", correct: true }] }).outcome).toBe("discard");
      expect(validateItemPayload("MCQ", { options: [{ text: "a", correct: true }, { text: "b", correct: true }] }).outcome).toBe("discard");
      expect(validateItemPayload("MCQ", { options: [{ text: "a", correct: true }, { text: "b" }] }).outcome).toBe("pass");
    });
    it("has exactly the seven kinds", () => {
      expect([...ITEM_KINDS]).toEqual(["MCQ", "SHORT", "NUMERIC", "ORDERING", "MATCHING", "ARTIFACT", "CODE"]);
    });
  });

  it("a distractor diagnoses a misconception (§13.2)", () => {
    const { item } = buildItem({
      kind: "MCQ",
      prompt: "What does a plant do with sunlight?",
      payload: { options: [{ text: "converts it", correct: true }, { text: "eats it", diagnosesMisconception: "plants eat sunlight" }] },
      contextId: "ctx",
    });
    expect(item.trustLevel).toBe("MACHINE_PROPOSED"); // never self-asserts trust (ADR-2)
    expect(diagnosedMisconception(item, 1)).toBe("plants eat sunlight");
    expect(diagnosedMisconception(item, 0)).toBeNull(); // the correct one diagnoses nothing
  });

  it("F5 — recorded-as-evidence is an AssessmentItem; otherwise practice (§13.2)", () => {
    expect(classifyByOutcome(true)).toBe("AssessmentItem");
    expect(classifyByOutcome(false)).toBe("Exercise");
  });

  it("items are scope + trust gated for a concept", async () => {
    const store = createMemoryStore();
    const { item } = buildItem({ kind: "SHORT", prompt: "Define osmosis", payload: {}, contextId: "ctx" });
    await store.putAssessmentItem({ ...item, trustLevel: "COMMUNITY_REVIEWED" });
    await store.putItemConcept({ itemId: item.id, conceptId: "osmosis", role: "TESTS", bloom: "UNDERSTAND" });
    const served = await store.itemsForConcept("osmosis", "PUBLIC", POLICIES.GENERAL_SCHOOL);
    expect(served).toHaveLength(1);
    // a research-only item is refused by the school policy
    await store.putAssessmentItem({ ...buildItem({ kind: "SHORT", prompt: "x", payload: {}, contextId: "ctx" }).item, id: "i2", trustLevel: "MACHINE_PROPOSED" });
    await store.putItemConcept({ itemId: "i2", conceptId: "osmosis", role: "TESTS", bloom: null });
    expect(await store.itemsForConcept("osmosis", "PUBLIC", POLICIES.GENERAL_SCHOOL)).toHaveLength(1);
  });

  // point-in-time replay (§19): a lesson resolves to the EXACT versions its release pinned.
  it("replay resolves a lesson to the versions the release pinned, not what is current", async () => {
    const store = createMemoryStore();
    const v1 = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "s", predicate: "p", objectId: "o" }, text: "v1", contextId: "ctx" }), id: "s-v1" };
    await store.putStatement(v1);
    // pin v1 in a release — this is what a March lesson recorded
    const { release, members } = buildRelease("2026-03-01-01", "March", [{ kind: "Statement", entityId: "s-v1" }], new Date(1_700_000_000_000));
    await store.putRelease(release, members);
    // later, v1 is superseded by v2 (a different id) — v1 stays readable (append-only)
    const { next: v2, deprecated } = supersede(v1, { ...v1, text: "v2" } as typeof v1, "s-v2");
    await store.putStatement(v2);
    await store.putStatement(deprecated);

    const replay = await replayLesson(store, { releaseId: "2026-03-01-01", statementIds: ["s-v1"], assetIds: [] });
    expect(replay.statements[0]).toEqual({ requested: "s-v1", pinned: "s-v1" }); // the learner saw v1
    expect(replay.complete).toBe(true);
    // v2 was never in this release, so replaying it resolves to nothing
    const missing = await replayLesson(store, { releaseId: "2026-03-01-01", statementIds: ["s-v2"], assetIds: [] });
    expect(missing.statements[0].pinned).toBeNull();
    expect(missing.complete).toBe(false);
  });
});
