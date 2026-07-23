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

  it("nothing is auto-promoted — everything lands at MACHINE_PROPOSED (review-gated)", async () => {
    const store = createMemoryStore();
    await ingestSource(store, testConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });

    const subject = await store.resolveSlug("chlorophyll", "PUBLIC");
    expect(subject.kind).toBe("concept");
    if (subject.kind !== "concept") return;

    // RND (floor MACHINE_PROPOSED) admits the fresh statement; GENERAL_SCHOOL (floor
    // COMMUNITY_REVIEWED) refuses it → proof it is NOT served to learners until human review.
    const admitted = await store.statementsForSubject(subject.conceptId, "PUBLIC", POLICIES.RND);
    const served = await store.statementsForSubject(subject.conceptId, "PUBLIC", POLICIES.GENERAL_SCHOOL);
    expect(admitted.length).toBeGreaterThanOrEqual(1);
    expect(admitted.every((s) => s.trustLevel === "MACHINE_PROPOSED")).toBe(true);
    expect(served.length).toBe(0);
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

  // ── R1: the batch cliff is real; it must never be invisible. ──
  it("records a batch-discard with the extractor, chunk and zod path when accept() rejects", async () => {
    const bad = {
      entities: [{ name: "Light" }],
      statements: [{ form: "NOT_A_FORM", kind: "FACT", text: "x", quote: "y", structure: {} }], // one bad element kills the array
      dependencies: [], assets: [], items: [],
    };
    const r = await ingestSource(createMemoryStore(), testConnector, "photosynthesis.md", async () => ({ raw: JSON.stringify(bad), data: bad }), { modelId: "fake" });

    expect(r.counts.statements).toBe(0);
    const discard = r.omissions.find((o) => o.kind === "batch-discard" && o.data?.extractor === "statements");
    expect(discard).toBeDefined();
    expect(discard?.reason).toContain("statements:");
    expect(discard?.data?.zodPath).toBe("0.form");
    expect(discard?.data?.elements).toBe(1);

    // and the chunk it happened in is reported barren, with the reason
    const barren = r.omissions.find((o) => o.kind === "barren-chunk");
    expect(barren?.reason).toContain("proposed no statements");
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
