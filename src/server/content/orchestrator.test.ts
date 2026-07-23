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
});
