import { describe, it, expect, vi } from "vitest";

// The orchestrator emits an evidence event per stage; in a node test there is no DB, so stub
// emit (the returned `stages` array — populated before emit — is what we assert on).
vi.mock("@/server/events", async (orig) => {
  const actual = await orig<typeof import("@/server/events")>();
  return { ...actual, emit: vi.fn(async () => "evt"), emitMany: vi.fn(async () => []) };
});

import { ingestSource } from "@/server/content/orchestrator";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { POLICIES } from "@/server/knowledge/trust/policy";
import { requiresHumanReview } from "@/server/knowledge/trust/ladder";
import type { SourceConnector } from "@/server/ingest/connector";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

// A generic, non-copyrighted fixture — structure + a groundable sentence. This proves the
// FACTORY, not content; it is a synthetic public-domain example.
const CONTENT = [
  "# Photosynthesis",
  "",
  "Chlorophyll absorbs light in the visible spectrum. Photosynthesis requires light to occur.",
  "",
].join("\n");

const testConnector: SourceConnector = {
  id: "test-fixture",
  kinds: ["book"],
  async license() {
    return { permitted: true, license: "CC0-1.0", requiresApproval: false };
  },
  async fetch() {
    return {
      source: { kind: "book", title: "photosynthesis.md", publisher: "public-domain", authority: "test", uri: "file:///photosynthesis.md", license: "CC0-1.0" },
      bytes: Buffer.from(CONTENT, "utf8"),
    };
  },
};

// One fake invoker returns the same proposal bundle every call; each extractor reads only its
// own key (entities / statements / dependencies / assets / items).
const fixture = {
  entities: [{ name: "Chlorophyll" }, { name: "Light" }, { name: "Photosynthesis" }],
  statements: [
    {
      form: "SPO",
      kind: "FACT",
      text: "Chlorophyll captures light within the visible range.",
      quote: "Chlorophyll absorbs light in the visible spectrum",
      structure: {},
      subject: "Chlorophyll",
      predicate: "absorbs",
      object: "Light",
    },
  ],
  dependencies: [{ fromName: "Photosynthesis", toName: "Light", classification: "REQUIRES" }],
  assets: [{ kind: "MISCONCEPTION", conceptName: "Photosynthesis", payload: { misconception: "plants eat soil", correction: "plants make food from light" } }],
  items: [{ kind: "MCQ", conceptName: "Photosynthesis", prompt: "What does chlorophyll absorb?", payload: { options: ["Light", "Soil"], correctIndex: 0 } }],
};
const fakeInvoke: JsonInvoke = async () => ({ raw: JSON.stringify(fixture), data: fixture });

describe("ingest orchestrator (W1) — the pipeline spine, end-to-end", () => {
  it("drives Source → parse → chunk → extract → validate → persist and emits one event per stage", async () => {
    const store = createMemoryStore();
    const r = await ingestSource(store, testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });

    // every stage fired, in pipeline order (per-chunk extracted/validated appear between chunked and enqueued)
    expect(r.stages[0]).toBe("ingest.acquired");
    expect(r.stages).toEqual(expect.arrayContaining([
      "ingest.acquired", "ingest.parsed", "ingest.normalised", "ingest.chunked",
      "ingest.discovered", "ingest.extracted", "ingest.validated", "ingest.enqueued",
    ]));
    expect(r.stages[r.stages.length - 1]).toBe("ingest.enqueued");

    // chunks produced; entities became DRAFT concepts
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.counts.concepts).toBeGreaterThanOrEqual(3);
    expect(r.counts.statements).toBeGreaterThanOrEqual(1);

    // discovery ran (default-on, structure only): the "# Photosynthesis" heading → one chapter
    expect(r.hierarchy.profile).toBe("generic");
    expect(r.hierarchy.nodes[0]?.title).toBe("Photosynthesis");
    expect(r.hierarchy.nodes[0]?.level).toBe("chapter");
  });

  it("ingest stops at the MACHINE CEILING and is never served to a learner (§14, §26.2)", async () => {
    const store = createMemoryStore();
    await ingestSource(store, testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });

    const subject = await store.resolveSlug("chlorophyll", "PUBLIC");
    expect(subject.kind).toBe("concept");
    if (subject.kind !== "concept") return;

    const admitted = await store.statementsForSubject(subject.conceptId, "PUBLIC", POLICIES.RND);
    const served = await store.statementsForSubject(subject.conceptId, "PUBLIC", POLICIES.GENERAL_SCHOOL);
    expect(admitted.length).toBeGreaterThanOrEqual(1);

    // §14: passing every applicable gate IS AUTO_VALIDATED — a defined epistemic state, not a
    // promotion. It is the ceiling a machine can reach: nothing lands above it without a human.
    expect(admitted.every((s) => !requiresHumanReview(s.trustLevel))).toBe(true);
    expect(admitted.some((s) => s.trustLevel === "AUTO_VALIDATED")).toBe(true);
    expect(admitted.every((s) => s.validationMethods.includes("V3"))).toBe(true); // the level cites its evidence

    // The property that protects a learner is unchanged: GENERAL_SCHOOL (floor COMMUNITY_REVIEWED)
    // refuses everything ingest can produce, so nothing reaches a student without human review.
    expect(served.length).toBe(0);
  });

  it("a statement that fails any gate stays MACHINE_PROPOSED — the ceiling is earned, not given", async () => {
    // V5 flags text copied from the source; a flag is not a pass, so no auto-validation.
    const copied = {
      entities: [{ name: "Chlorophyll" }],
      statements: [{ form: "DEFINITIONAL", kind: "DEFINITION", text: "Chlorophyll absorbs light", quote: "Chlorophyll absorbs light in the visible spectrum", structure: { subject: "Chlorophyll" } }],
      dependencies: [], assets: [], items: [],
    };
    const store = createMemoryStore();
    await ingestSource(store, testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(copied), data: copied }), { modelId: "fake" });

    const subject = await store.resolveSlug("chlorophyll", "PUBLIC");
    if (subject.kind !== "concept") throw new Error("subject not created");
    const admitted = await store.statementsForSubject(subject.conceptId, "PUBLIC", POLICIES.RND);
    expect(admitted).toHaveLength(1);
    expect(admitted[0].trustLevel).toBe("MACHINE_PROPOSED");
    expect(admitted[0].validationMethods).toEqual([]);
  });

  it("collectProposals surfaces the accepted proposals + full text for quality scoring (W3)", async () => {
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake", collectProposals: true });
    expect(r.proposals?.length).toBeGreaterThanOrEqual(1);
    expect(r.proposals?.[0]?.subject).toBe("Chlorophyll");
    expect(r.text).toContain("Chlorophyll absorbs light");
  });

  it("is deterministic + resumable — the same source yields the same chunk ids", async () => {
    const a = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });
    const b = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });
    expect(a.chunks.map((c) => c.id)).toEqual(b.chunks.map((c) => c.id));
    expect(a.sourceId).toBe(b.sourceId);
  });

  // EVIL PATH: re-ingesting the SAME source into the SAME store must not duplicate anything.
  it("is idempotent — re-ingesting a source does not double statements/concepts", async () => {
    const store = createMemoryStore();
    const first = await ingestSource(store, testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });
    const subject = await store.resolveSlug("chlorophyll", "PUBLIC");
    if (subject.kind !== "concept") throw new Error("subject not created");
    const after1 = (await store.statementsForSubject(subject.conceptId, "PUBLIC", POLICIES.RND)).length;

    const second = await ingestSource(store, testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });
    const after2 = (await store.statementsForSubject(subject.conceptId, "PUBLIC", POLICIES.RND)).length;

    expect(after2).toBe(after1); // no new statements on re-run
    expect(second.counts.statements).toBe(0); // all skipped as duplicates
    expect(second.counts.duplicatesSkipped ?? 0).toBeGreaterThanOrEqual(1);
    expect(first.counts.concepts).toBeGreaterThan(0); // first run did create
  });

  // ── A2: provenance must resolve. Source + chunk rows exist BEFORE extraction. ──
  it("persists the Source and every SourceChunk, so no provenance row dangles", async () => {
    const store = createMemoryStore();
    const r = await ingestSource(store, testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });

    expect(r.stages).toContain("ingest.chunks_persisted");
    const src = await store.getSource(r.sourceId);
    expect(src).not.toBeNull();
    expect(src?.license).toBe("CC0-1.0");
    expect(src?.checksum).toHaveLength(64); // sha256 of the fetched bytes

    const stored = await store.chunksForSource(r.sourceId);
    expect(stored.map((c) => c.id)).toEqual(r.chunks.map((c) => c.id));
    expect(stored[0].text.length).toBeGreaterThan(0);

    // every provenance row resolves to a real source AND a real chunk
    const subject = await store.resolveSlug("chlorophyll", "PUBLIC");
    if (subject.kind !== "concept") throw new Error("subject not created");
    const stmts = await store.statementsForSubject(subject.conceptId, "PUBLIC", POLICIES.RND);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
    for (const s of stmts) {
      for (const p of await store.provenanceFor(s.id)) {
        expect(await store.getSource(p.sourceId)).not.toBeNull();
        expect(await store.getSourceChunk(p.chunkId)).not.toBeNull();
      }
    }
  });

  // ── A-5: every form is reachable from its concept, not SPO alone. ──
  it("attaches a subjectId for EVERY statement form (amendment A-5)", async () => {
    const forms = {
      entities: [{ name: "Prime factorisation" }, { name: "Decimal expansion" }],
      statements: [
        { form: "DEFINITIONAL", kind: "DEFINITION", text: "A definition written in our own words.", quote: "Chlorophyll absorbs light", structure: { subject: "Prime factorisation", predicate: "is" } },
        { form: "CAUSAL", kind: "PRINCIPLE", text: "One thing brings about another.", quote: "Photosynthesis requires light", structure: { subject: "Decimal expansion", predicate: "reveals" } },
        { form: "QUANTIFIED", kind: "FACT", text: "There are infinitely many of them.", quote: "in the visible spectrum", structure: { subject: "Prime factorisation" } },
      ],
      dependencies: [],
      assets: [],
      items: [],
    };
    const store = createMemoryStore();
    const r = await ingestSource(store, testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(forms), data: forms }), { modelId: "fake" });

    expect(r.counts.statements).toBe(3);
    expect(r.counts.unattachedStatements).toBe(0);

    const prime = await store.resolveSlug("prime-factorisation", "PUBLIC");
    if (prime.kind !== "concept") throw new Error("subject concept not created");
    const reachable = await store.statementsForSubject(prime.conceptId, "PUBLIC", POLICIES.RND);
    expect(reachable.map((s) => s.form).sort()).toEqual(["DEFINITIONAL", "QUANTIFIED"]);
    expect(reachable.every((s) => s.subjectId === prime.conceptId)).toBe(true);
  });

  // ── R1: a statement with no nameable subject is still persisted — but never silently. ──
  it("records subject-unresolved rather than dropping or hiding it (R1)", async () => {
    const anon = {
      entities: [{ name: "Light" }],
      statements: [{ form: "DEFINITIONAL", kind: "DEFINITION", text: "Something is asserted with no subject named.", quote: "Chlorophyll absorbs light", structure: {} }],
      dependencies: [], assets: [], items: [],
    };
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(anon), data: anon }), { modelId: "fake" });

    expect(r.counts.statements).toBe(1); // persisted, not dropped
    expect(r.counts.unattachedStatements).toBe(1);
    const rec = r.omissions.find((o) => o.kind === "subject-unresolved");
    expect(rec?.reason).toContain("no subject name");
    expect(rec?.chunkId).toBeTruthy();
  });

  // ── A-6: one invalid element must not destroy the batch — the measured cause of the yield collapse. ──
  it("keeps the valid proposals when one element is malformed, and records the dropped one (A-6)", async () => {
    const mixed = {
      entities: [{ name: "Chlorophyll" }],
      statements: [
        // exactly the real failure: a form the model invented, alongside good statements
        { form: "HISTORICAL", kind: "FACT", text: "Discovered long ago.", quote: "Chlorophyll absorbs light", structure: { subject: "Chlorophyll" } },
        { form: "DEFINITIONAL", kind: "DEFINITION", text: "A pigment that takes in light.", quote: "Chlorophyll absorbs light", structure: { subject: "Chlorophyll" } },
        { form: "CAUSAL", kind: "PRINCIPLE", text: "Light drives the process.", quote: "Photosynthesis requires light", structure: { subject: "Chlorophyll" } },
      ],
      dependencies: [], assets: [], items: [],
    };
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(mixed), data: mixed }), { modelId: "fake" });

    expect(r.counts.statements).toBe(2); // the two good ones survived; under the old batch rule this was 0
    const dropped = r.omissions.find((o) => o.kind === "element-discard" && o.data?.extractor === "statements");
    expect(dropped).toBeDefined();
    expect(dropped?.data?.index).toBe(0);
    expect(dropped?.data?.zodPath).toBe("form");
    expect(dropped?.data?.preview).toContain("HISTORICAL"); // the reason is checkable, not just asserted
  });

  it("an explicit null where a string was optional does not cost the statement its subject", async () => {
    // Local models write "subject": null rather than omitting the key; under a bare .optional()
    // that null failed the element, and with it the concept link (A-5).
    const withNulls = {
      entities: [{ name: "Chlorophyll", slug: null, aliases: null }],
      statements: [{ form: "DEFINITIONAL", kind: "DEFINITION", text: "A light-absorbing pigment.", quote: "Chlorophyll absorbs light", structure: { subject: "Chlorophyll" }, object: null, objectLit: null, contextDimensions: null }],
      dependencies: [], assets: [], items: [],
    };
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(withNulls), data: withNulls }), { modelId: "fake" });

    expect(r.counts.statements).toBe(1);
    expect(r.counts.unattachedStatements).toBe(0);
    expect(r.omissions.filter((o) => o.kind === "element-discard")).toHaveLength(0);
  });

  it("reports a chunk as barren, with the reason, when nothing survives", async () => {
    const allBad = {
      entities: [{ name: "Light" }],
      statements: [{ form: "NOT_A_FORM", kind: "FACT", text: "x", quote: "y", structure: {} }],
      dependencies: [], assets: [], items: [],
    };
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(allBad), data: allBad }), { modelId: "fake" });

    expect(r.counts.statements).toBe(0);
    expect(r.omissions.find((o) => o.kind === "barren-chunk")?.reason).toContain("proposed no statements");
  });

  // ── §13.3 / V14: an analogy with no breakdown point must never reach the graph. ──
  it("refuses an ANALOGY that does not say where it breaks down (V14)", async () => {
    const bad = {
      entities: [{ name: "Chlorophyll" }],
      statements: [],
      dependencies: [],
      assets: [
        { kind: "ANALOGY", conceptName: "Chlorophyll", payload: { source: "a solar panel", mapping: "both capture light" } }, // no breakdownPoint
        { kind: "ANALOGY", conceptName: "Chlorophyll", payload: { source: "a solar panel", mapping: "both capture light", breakdownPoint: "a panel makes electricity, not sugar" } },
      ],
      items: [],
    };
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(bad), data: bad }), { modelId: "fake" });

    expect(r.counts.assets).toBe(1); // only the one that states its limit
    expect(r.counts.assetsRejected).toBe(1);
    const rej = r.omissions.find((o) => o.kind === "asset-rejected");
    expect(rej?.reason).toContain("V14");
    expect(rej?.reason).toContain("ANALOGY_MISSING_BREAKDOWN_POINT");
  });

  // ── Resilience: the failure that killed a 49-minute chapter must cost only its chunk. ──
  it("survives a chunk that throws — the chapter continues and the failure is recorded (R1)", async () => {
    // A multi-chunk source so there is something after the failure to prove it kept going.
    // chunkDoc flushes at ~1200 chars, so the fixture must actually exceed that to produce >1 chunk
    const para = (i: number) =>
      `Chlorophyll absorbs light in the visible spectrum. Passage ${i} restates that pigment captures ` +
      "radiant energy and that the process depends on that capture, written at sufficient length that " +
      "the chunker reaches its character budget and flushes a chunk boundary here rather than merging.";
    const many = ["# Photosynthesis", "", ...Array.from({ length: 8 }, (_, i) => para(i))].join("\n\n");
    const connector: SourceConnector = {
      ...testConnector,
      async fetch() {
        return { source: { kind: "book", title: "p.md", publisher: "pd", authority: "t", uri: "file:///p.md", license: "CC0-1.0" }, bytes: Buffer.from(many, "utf8") };
      },
    };

    let call = 0;
    const flaky: JsonInvoke = async () => {
      call++;
      if (call === 2) throw new TypeError("fetch failed"); // dies inside the first chunk
      return { raw: JSON.stringify(fixture), data: fixture };
    };

    const r = await ingestSource(createMemoryStore(), connector, "p.md", flaky, { modelId: "fake" });

    expect(r.chunks.length).toBeGreaterThan(1);
    expect(r.counts.chunkFailures).toBe(1);
    expect(r.counts.statements).toBeGreaterThan(0); // later chunks still ran — the chapter survived
    const failed = r.omissions.find((o) => o.kind === "chunk-failed");
    expect(failed?.reason).toContain("fetch failed");
    expect(failed?.chunkId).toBeTruthy();
  });

  it("a deliberate abort stops the run — it is not swallowed as a chunk failure", async () => {
    const ac = new AbortController();
    ac.abort();
    const boom: JsonInvoke = async () => { throw new TypeError("fetch failed"); };

    await expect(
      ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", boom, { modelId: "fake", signal: ac.signal }),
    ).rejects.toThrow(/fetch failed/);
  });

  it("skips already-extracted chunks on resume — no model call, no repeated cost", async () => {
    const store = createMemoryStore();
    const first = await ingestSource(store, testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });
    const doneIds = new Set(first.chunks.map((c) => c.id));

    let calls = 0;
    const counting: JsonInvoke = async () => { calls++; return { raw: JSON.stringify(fixture), data: fixture }; };
    const resumed = await ingestSource(store, testConnector, "photosynthesis.md", counting, { modelId: "fake", skipChunkIds: doneIds });

    expect(resumed.counts.skippedChunks).toBe(first.chunks.length);
    expect(calls).toBe(0); // the whole point: zero model calls for work already done
  });

  it("reports each chunk as it completes, so progress can be checkpointed mid-chapter", async () => {
    const seen: string[] = [];
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", fakeInvoke, {
      modelId: "fake", onChunkDone: (id) => seen.push(id),
    });
    expect(seen).toEqual(r.chunks.map((c) => c.id));
  });

  // ── M0c: items were the ONE artefact persisted with no gate. ──
  it("refuses a malformed assessment item — an MCQ without exactly one correct option", async () => {
    const bad = {
      entities: [{ name: "Chlorophyll" }],
      statements: [], dependencies: [], assets: [],
      items: [
        // two correct options — MCQ_NEEDS_EXACTLY_ONE_CORRECT
        { kind: "MCQ", conceptName: "Chlorophyll", prompt: "What does chlorophyll absorb?", payload: { options: [{ text: "Light", correct: true }, { text: "Sun", correct: true }] } },
        // no correct option at all
        { kind: "MCQ", conceptName: "Chlorophyll", prompt: "Which colour is reflected?", payload: { options: [{ text: "Red" }, { text: "Green" }] } },
        // well-formed — exactly one correct
        { kind: "MCQ", conceptName: "Chlorophyll", prompt: "Which range does it absorb?", payload: { options: [{ text: "Visible", correct: true }, { text: "Radio" }] } },
      ],
    };
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(bad), data: bad }), { modelId: "fake" });

    expect(r.counts.items).toBe(1); // only the valid one reached the graph
    const rejected = r.omissions.filter((o) => o.kind === "item-rejected");
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reason).toContain("MCQ_NEEDS_EXACTLY_ONE_CORRECT");
    expect(rejected[1].reason).toContain("MCQ_NEEDS_EXACTLY_ONE_CORRECT");
  });

  // ── R1: statement and dependency rejects are separate numbers. ──
  it("splits statement and dependency reject counters and names the failing gate", async () => {
    const ungrounded = {
      entities: [{ name: "Light" }],
      statements: [{ form: "SPO", kind: "FACT", text: "Own words.", quote: "THIS QUOTE IS NOT IN THE SOURCE AT ALL", structure: {}, subject: "Light", predicate: "is" }],
      dependencies: [], assets: [], items: [],
    };
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(ungrounded), data: ungrounded }), { modelId: "fake" });

    expect(r.counts.statementsRejected).toBe(1);
    expect(r.counts.dependenciesRejected).toBe(0);
    const rej = r.omissions.find((o) => o.kind === "statement-rejected");
    expect(rej?.reason).toContain("V3"); // grounding gate named, with its reason
    expect(Array.isArray(rej?.data?.gates)).toBe(true);
  });
});
