import { describe, it, expect } from "vitest";
import { chooseOutline, groundedOutline, GROUNDED_PROMPT_VERSION, sourceGroundedOutline, SOURCE_PROMPT_VERSION } from "@/server/conversation/grounding";
import { defaultOutline, isVisual, repairOutline } from "@/server/conversation/outline";

// WIRING (§H1.7, red-team P3-F1): the outline goes through repairOutline before the prompt. That must
// NOT truncate the passage/citation out — the earlier bug clamped intent to 200 chars and silently
// deleted every grounded fact. Test through the real pipeline, not just the builder.
describe("grounded outline survives repairOutline — the passage reaches the prompt", () => {
  it("keeps the passage + citation after repairOutline (not truncated away)", async () => {
    const store = createMemoryStore();
    await store.putSource({ id: "s", kind: "textbook", title: "NCERT Class 10 Maths", publisher: "NCERT", authority: "CBSE", edition: null, publishedAt: null, uri: "f", checksum: "s", license: "x", licenseUrl: null, ingestedAt: new Date() });
    await store.putSourceChunk({ id: "c", sourceId: "s", locator: { page: 1, range: [0, 80] }, text: "Every composite number can be expressed as a product of primes, unique apart from order.", ordinal: 0 });
    const g = await sourceGroundedOutline(store, "prime factorisation of a composite number");
    const { outline } = repairOutline(g!.outline, "prime factorisation of a composite number");
    const joined = outline.map((s) => s.intent).join(" ");
    expect(joined).toMatch(/product of primes/i);   // the actual passage survived the pipeline
    expect(joined.toLowerCase()).toContain("ncert"); // the citation survived
  });
});
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";

// ── Phase 2 (A-7): source-retrieval grounding — teach from retrieved NCERT passages ──
describe("sourceGroundedOutline (A-7 — teach from the textbook, non-generic)", () => {
  const seedRealNumbers = async () => {
    const store = createMemoryStore();
    await store.putSource({ id: "src-rn", kind: "textbook", title: "NCERT Class 10 · Maths · Real Numbers", publisher: "NCERT", authority: "CBSE", edition: null, publishedAt: null, uri: "file://01.md", checksum: "rn", license: "NCERT-operator-asserted", licenseUrl: null, ingestedAt: new Date() });
    await store.putSourceChunk({ id: "rn-0", sourceId: "src-rn", locator: { page: 1, range: [0, 60] }, text: "The Fundamental Theorem of Arithmetic: every composite number can be expressed as a product of primes, and this factorisation is unique apart from order.", ordinal: 0 });
    await store.putSourceChunk({ id: "rn-1", sourceId: "src-rn", locator: { page: 2, range: [0, 60] }, text: "Euclid's division lemma: given positive integers a and b, there exist unique integers q and r such that a = bq + r, where 0 <= r < b.", ordinal: 1 });
    return store;
  };

  it("returns null when nothing in the corpus matches (caller falls back, no hallucinated grounding)", async () => {
    const store = await seedRealNumbers();
    expect(await sourceGroundedOutline(store, "photosynthesis chlorophyll")).toBeNull();
  });

  it("builds a cited, block-structured lesson grounded in the retrieved passages", async () => {
    const store = await seedRealNumbers();
    const g = await sourceGroundedOutline(store, "prime factorisation of a composite number");
    expect(g).not.toBeNull();
    const outline = g!.outline;

    // shape: heading first, summary last, at least one visual block (not a prose wall)
    expect(outline[0].type).toBe("heading");
    expect(outline[outline.length - 1].type).toBe("summary");
    expect(outline.some((s) => isVisual(s.type))).toBe(true);

    // GROUNDED: a real retrieved passage drives a slot (not generic filler)
    const joined = outline.map((s) => s.intent).join(" \n ");
    expect(joined).toMatch(/product of primes|Fundamental Theorem of Arithmetic/);

    // CITED: the source is named so the student sees where it came from
    expect(joined).toMatch(/NCERT/);

    // teacher-voice contract: the slot instructs a plain rewrite, not a copy
    expect(joined.toLowerCase()).toMatch(/rewrite|simpl|plain|own words/);

    // evidence: marked as source-grounded, no graph concepts claimed
    expect(g!.promptVersion).toBe(SOURCE_PROMPT_VERSION);
    expect(g!.conceptIds).toEqual([]);
  });

  // A-7 INVARIANT (required by the amendment): the source path is read + present only. It must NEVER
  // write anything into canonical knowledge — no Statement, concept, edge, or trust-ladder row.
  it("writes ZERO graph rows — read+present only (A-7 invariant)", async () => {
    const store = await seedRealNumbers();
    const before = await store.dumpAll();

    await sourceGroundedOutline(store, "prime factorisation of a composite number");

    const after = await store.dumpAll();
    // the only rows that may exist are the Source + SourceChunks we seeded as INPUT — everything
    // that constitutes canonical knowledge must be untouched (empty, and identical before/after).
    expect(after.concepts).toEqual(before.concepts);
    expect(after.statements).toEqual(before.statements);
    expect(after.provenance).toEqual(before.provenance);
    expect(after.dependencyEdges).toEqual(before.dependencyEdges);
    expect(after.reviewEvents).toEqual(before.reviewEvents);
    expect(after.teachingAssets).toEqual(before.teachingAssets);
    // and concretely: no canonical knowledge exists at all
    expect(after.concepts.length + after.statements.length + after.reviewEvents.length).toBe(0);
  });

  // ANTI-GENERIC: the passage is ground truth for FACTS; the lesson must TEACH (intuition, example,
  // why-it-matters, common mistake) and be explicitly forbidden from restating the textbook definition.
  it("teaches the concept — never just restates/rewrites the NCERT definition", async () => {
    const store = await seedRealNumbers();
    const g = await sourceGroundedOutline(store, "prime factorisation of a composite number");
    const joined = g!.outline.map((s) => s.intent).join(" \n ").toLowerCase();

    // explicit anti-copy: don't restate the definition, use your own words
    expect(joined).toMatch(/do not restate|never repeat|your own words|not the textbook|do not copy/);
    // pedagogical variety — not N reworded definitions
    expect(joined).toMatch(/analogy|intuition/);
    expect(joined).toMatch(/example/);
    expect(joined).toMatch(/why it matters|where it('| i)s used|real life|used in/);
    expect(joined).toMatch(/mistake|misconception|confuse/);
    // still grounded in the real passage + cited (facts stay correct)
    expect(joined).toMatch(/product of primes|fundamental theorem of arithmetic/);
    expect(joined).toContain("ncert");
  });

  // HARDENING: a passage with newlines/quotes must not break the "Passage: …" prompt framing (and
  // this is the seam that neutralises injection when untrusted web text arrives in Phase 3).
  it("normalises passage punctuation (collapses newlines, neutralises inner quotes)", async () => {
    const store = createMemoryStore();
    await store.putSource({ id: "src-q", kind: "textbook", title: "NCERT Class 10 · Maths", publisher: "NCERT", authority: "CBSE", edition: null, publishedAt: null, uri: "file://q.md", checksum: "q", license: "x", licenseUrl: null, ingestedAt: new Date() });
    await store.putSourceChunk({ id: "q-0", sourceId: "src-q", locator: { page: 1, range: [0, 60] }, text: 'A prime number has exactly two factors.\nHe called it "special".', ordinal: 0 });

    const g = await sourceGroundedOutline(store, "prime number factors");
    const joined = g!.outline.map((s) => s.intent).join(" ");
    expect(joined).toContain("prime number");   // content preserved
    expect(joined).not.toContain("\n");          // newlines collapsed → single clean line
    expect(joined).not.toContain('"special"');   // inner double-quotes neutralised (framing intact)
  });
});

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
