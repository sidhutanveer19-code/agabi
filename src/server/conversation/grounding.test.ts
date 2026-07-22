import { describe, it, expect } from "vitest";
import { chooseOutline, groundedOutline, GROUNDED_PROMPT_VERSION } from "@/server/conversation/grounding";
import { defaultOutline } from "@/server/conversation/outline";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";

describe("M5 teaching bridge (§8.2)", () => {
  // The byte-identical guarantee: flag off (or a miss) ⇒ grounded=null ⇒ EXACT Phase-1 outline.
  it("chooseOutline with no grounding is byte-identical to defaultOutline", () => {
    for (const topic of ["photosynthesis", "the french revolution", "quadratic equations"]) {
      expect(chooseOutline(topic, null)).toEqual(defaultOutline(topic));
    }
  });

  it("chooseOutline uses the grounded outline when present", () => {
    const grounded = { outline: [{ slot: 1, type: "heading", intent: "x" }], conceptIds: ["c1"], promptVersion: GROUNDED_PROMPT_VERSION, assetCount: 0 };
    expect(chooseOutline("x", grounded)).toBe(grounded.outline);
  });

  describe("groundedOutline", () => {
    it("returns null (a MISS) when nothing covers the topic", async () => {
      const store = createMemoryStore();
      expect(await groundedOutline(store, "unheard-of-topic")).toBeNull();
    });

    it("grounds the outline in the real concepts when the graph covers the topic", async () => {
      const store = createMemoryStore();
      const c = buildConcept({ name: "Photosynthesis", slug: "photosynthesis" });
      await store.putConcept(c);
      const ctx = await store.putContext({ jurisdiction: "IN" });
      await store.putStatement({
        ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: c.id, predicate: "converts", objectId: "energy" }, text: "Plants convert light into chemical energy.", contextId: ctx.id }),
        subjectId: c.id,
        trustLevel: "COMMUNITY_REVIEWED", // servable under the student policy
      });

      const g = await groundedOutline(store, "photosynthesis");
      expect(g).not.toBeNull();
      expect(g!.conceptIds).toContain(c.id);
      expect(g!.promptVersion).toBe(GROUNDED_PROMPT_VERSION);
      expect(g!.outline[0]).toMatchObject({ type: "heading", intent: "photosynthesis" });
      // the grounded fact rode into a slot intent (the grounding, via the existing intent seam)
      expect(g!.outline.some((s) => s.intent.includes("Plants convert light"))).toBe(true);
      expect(g!.outline.at(-1)).toMatchObject({ type: "summary" });
    });

    it("still grounds structurally when a concept has no servable fact yet", async () => {
      const store = createMemoryStore();
      await store.putConcept(buildConcept({ name: "Osmosis", slug: "osmosis" }));
      const g = await groundedOutline(store, "osmosis");
      expect(g).not.toBeNull();
      expect(g!.outline.some((s) => s.intent.includes("explain Osmosis"))).toBe(true);
    });
  });
});
