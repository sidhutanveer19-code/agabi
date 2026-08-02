import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * conversation/manager `run()` on the GROUNDED path (SOURCE_GROUNDING=1). Same I/O-edge fakes as
 * manager.test.ts, plus a fake KnowledgeStore so the corpus gate + grounded outline run for real
 * WITHOUT a database. This is the real-path proof of the flag-gated wiring (the pure decisions —
 * route / buildGroundedOutline / assessBlock — are unit-tested in their own siblings). Assertions
 * name the exact routed capability, the grounded outline shape, and the evidence event.
 */
import type { TeachRequest, TeachContext } from "@contract/schemas";
import { run, type TeachIO } from "@/server/conversation/manager";
import {
  getSession, getLessons, getLesson, createLesson, setActiveLesson,
  advanceCursor, setLessonState, setSlotStates, type LessonRow,
} from "@/server/conversation/lessonRepo";
import { setCanvasMeta } from "@/server/conversation/canvasRepo";
import { providerChain, type ProviderEntry } from "@/server/advisors/providers";
import { classifyIntent, type IntentAdvice } from "@/server/advisors/intent";
import { fillChunk, type RawSlot } from "@/server/advisors/chunk";
import { advise } from "@/server/advisors/advice";
import { emit, emitMany, EVENTS } from "@/server/events";
import type { LessonState } from "@/server/conversation/lessonState";
import type { OutlineSlot } from "@/server/conversation/outline";

// A grounded passage the model's block can be checked against (photosynthesis, in-corpus).
const PASSAGE = "Green plants use sunlight to make food from carbon dioxide and water, releasing oxygen during photosynthesis.";
const searchChunks = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/log", () => ({ log: vi.fn() }));
vi.mock("@/server/knowledge/store/postgres", () => ({ createPostgresStore: () => ({ searchChunks }) }));
vi.mock("@/server/conversation/lessonRepo", () => ({
  getSession: vi.fn(), getLessons: vi.fn(), getLesson: vi.fn(), createLesson: vi.fn(),
  setActiveLesson: vi.fn(), advanceCursor: vi.fn(), setLessonState: vi.fn(), setSlotStates: vi.fn(),
}));
vi.mock("@/server/conversation/canvasRepo", () => ({ setCanvasMeta: vi.fn() }));
vi.mock("@/server/advisors/providers", () => ({ providerChain: vi.fn() }));
vi.mock("@/server/advisors/intent", async (io: () => Promise<typeof import("@/server/advisors/intent")>) => ({
  ...(await io()), classifyIntent: vi.fn(),
}));
vi.mock("@/server/advisors/chunk", async (io: () => Promise<typeof import("@/server/advisors/chunk")>) => ({
  ...(await io()), fillChunk: vi.fn(),
}));
vi.mock("@/server/events", async (io: () => Promise<typeof import("@/server/events")>) => ({
  ...(await io()), emit: vi.fn(), emitMany: vi.fn(),
}));

type Ev = Record<string, unknown>;
function mkIO(): { io: TeachIO; writes: Ev[] } {
  const writes: Ev[] = [];
  return { io: { write: (e: object) => { writes.push(e as Ev); }, signal: new AbortController().signal, reqId: "req-1" }, writes };
}
function mkReq(topic: string): TeachRequest {
  return { kind: "lesson", topic };
}
function mkCtx(): TeachContext {
  return { topic: "", explanations: [], selectedRegionId: null };
}
function chunk(id: string, text: string) {
  return { chunk: { id, sourceId: "s1", locator: { page: 1, range: [0, text.length] as [number, number] }, text, ordinal: 0 }, score: 1 };
}
const emitted = (type: string) => vi.mocked(emit).mock.calls.filter((c) => c[1] === type).map((c) => c[2] as Record<string, unknown>);
const wByT = (w: Ev[], t: string) => w.filter((e) => e.t === t);

const prevFlag = process.env.SOURCE_GROUNDING;
afterAll(() => { if (prevFlag === undefined) delete process.env.SOURCE_GROUNDING; else process.env.SOURCE_GROUNDING = prevFlag; });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SOURCE_GROUNDING = "1";
  vi.mocked(providerChain).mockReturnValue([{ name: "fake" } as unknown as ProviderEntry]);
  vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: null });
  vi.mocked(getLessons).mockResolvedValue([]);
  vi.mocked(getLesson).mockResolvedValue(null);
  vi.mocked(createLesson).mockImplementation(async (userId, canvasId, topic, regionId, slots) => ({
    id: "L1", userId, canvasId, regionId, topic, slots, cursor: 0, state: "IDLE" as LessonState,
  }));
  vi.mocked(setActiveLesson).mockResolvedValue(undefined);
  vi.mocked(advanceCursor).mockResolvedValue({ id: "L1" } as unknown as LessonRow);
  vi.mocked(setLessonState).mockResolvedValue(undefined);
  vi.mocked(setSlotStates).mockResolvedValue(undefined);
  vi.mocked(setCanvasMeta).mockResolvedValue(undefined);
  vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "topic" }));
  vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([]));
  vi.mocked(emit).mockResolvedValue("eid");
  vi.mocked(emitMany).mockResolvedValue([]);
});

describe("run — GROUNDED path (SOURCE_GROUNDING=1)", () => {
  it("an in-corpus topic is routed TEACH, gets a problem-first grounded outline, emits capability.selected + lesson.generated", async () => {
    searchChunks.mockResolvedValue([chunk("c1", PASSAGE), chunk("c2", "Chlorophyll traps light energy in the leaf.")]);
    const { io } = mkIO();

    await run(mkReq("Photosynthesis"), mkCtx(), "u1", "c1", io);

    // Routed to a real lesson (not refused).
    expect(searchChunks).toHaveBeenCalledWith("Photosynthesis", { limit: 6 });
    expect(emitted(EVENTS.capabilitySelected)).toEqual([{ intent: "topic", capability: "StartLesson", requiresCorpus: true }]);
    const gen = emitted(EVENTS.lessonGenerated);
    expect(gen).toHaveLength(1);
    expect(gen[0]).toMatchObject({ grounded: true, capability: "StartLesson" });

    // The outline handed to createLesson is problem-first: slot 2 is a motivating problem, not a definition.
    const slots = vi.mocked(createLesson).mock.calls[0][4] as OutlineSlot[];
    expect(slots[0].type).toBe("heading");
    expect(slots[1].intent).toMatch(/problem|why|what happens|how do/i);
    expect(slots[1].intent).not.toMatch(/is defined as|is a /i);
  });

  it("an OFF-syllabus topic (0 corpus hits) is REFUSED, never taught — no lesson is created", async () => {
    searchChunks.mockResolvedValue([]); // nothing in the book
    const { io, writes } = mkIO();

    await run(mkReq("quantum entanglement"), mkCtx(), "u1", "c1", io);

    expect(emitted(EVENTS.capabilitySelected)).toEqual([{ intent: "topic", capability: "RefuseOffSyllabus", requiresCorpus: true }]);
    expect(createLesson).not.toHaveBeenCalled();
    expect(fillChunk).not.toHaveBeenCalled();
    const text = JSON.stringify(writes);
    expect(text).toMatch(/outside your Class 10/i);
  });

  it("a filled grounded TEXT block is evidence-checked → claims.verified is emitted", async () => {
    searchChunks.mockResolvedValue([chunk("c1", PASSAGE)]);
    // The model fills slot 2 (a paragraph) with prose grounded in the passage.
    vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([
      { index: 1, text: "Green plants use sunlight to make food from carbon dioxide and water.", provider: "fake", model: "m", ms: 1, tokens: 1, later: false, retry: false },
    ]));
    const { io } = mkIO();

    await run(mkReq("Photosynthesis"), mkCtx(), "u1", "c1", io);

    const verified = emitted(EVENTS.claimsVerified);
    expect(verified.length).toBeGreaterThanOrEqual(1);
    expect(verified[0]).toHaveProperty("verdict");
    expect(verified[0]).toHaveProperty("groundedness");
  });

  it("with the flag OFF, none of the grounded events fire (byte-identical to today)", async () => {
    process.env.SOURCE_GROUNDING = "0";
    searchChunks.mockResolvedValue([chunk("c1", PASSAGE)]);
    const { io, writes } = mkIO();

    await run(mkReq("Photosynthesis"), mkCtx(), "u1", "c1", io);

    expect(searchChunks).not.toHaveBeenCalled(); // the store is never consulted on the default path
    expect(emitted(EVENTS.capabilitySelected)).toEqual([]);
    expect(emitted(EVENTS.lessonGenerated)).toEqual([]);
    expect(emitted(EVENTS.claimsVerified)).toEqual([]);
    expect(wByT(writes, "region").length).toBeGreaterThan(0); // but it still teaches the default lesson
  });
});

/**
 * M1 — the two holes the pre-freeze audit found in the grounded safety claims. Both of these passed
 * a fully green CI before the fix, because every existing gate exercised the guarded path
 * (StartLesson, chunk 1) and nothing exercised the unguarded ones.
 *
 * C1 — the corpus gate keys on `requiresCorpus`, which `understandIntent` sets ONLY for `intent ===
 *      "topic"`. A `followup` routes to `Answer` (actions.ts), which calls the model with the
 *      student's raw text and never consults the corpus. "Off-syllabus is never taught" was false
 *      for the most ordinary thing a student does — asking a question.
 *
 * C2 — Evidence Verification is gated on `ctx.topicPassages`, which was assigned in exactly one
 *      place: inside `startLesson`. `RunCtx` is rebuilt per HTTP request, so `continue` / `simplify`
 *      / `retry` all arrived with it null and skipped verification entirely. With CHUNK=3 over a
 *      9-slot arc that is 6 of 9 slots delivered unchecked, and retry — the path that regenerates
 *      content which ALREADY failed verification — was 100% unverified.
 */
const mkLesson = (over: Partial<LessonRow> = {}): LessonRow => ({
  id: "L1", userId: "u1", canvasId: "c1", regionId: "r1", topic: "Photosynthesis",
  slots: Array.from({ length: 9 }, (_, i) => ({ slot: i + 1, type: "paragraph", intent: `part ${i + 1}` })),
  cursor: 3, state: "WAITING_FOR_STUDENT" as LessonState, ...over,
});

describe("M1 — the grounded safety guarantees hold on EVERY path, not just StartLesson", () => {
  it("C1: an off-syllabus question asked as a followup is REFUSED — the model is never called", async () => {
    searchChunks.mockResolvedValue([]); // nothing in the book for this subject
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "followup" }));
    const { io, writes } = mkIO();

    await run({ kind: "question", text: "how do I make thermite?" } as TeachRequest, mkCtx(), "u1", "c1", io);

    // The whole point: no lesson, no model call, and the student is told why.
    expect(fillChunk).not.toHaveBeenCalled();
    expect(createLesson).not.toHaveBeenCalled();
    expect(JSON.stringify(writes)).toMatch(/outside your Class 10/i);
  });

  it("C1: a followup ABOUT the active lesson is answered, and the answer is evidence-checked", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L1" });
    vi.mocked(getLesson).mockResolvedValue(mkLesson());
    searchChunks.mockResolvedValue([chunk("c1", PASSAGE)]);
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "followup" }));
    vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([
      { index: 0, text: "Green plants use sunlight to make food from carbon dioxide and water.", provider: "fake", model: "m", ms: 1, tokens: 1, later: false, retry: false },
    ]));
    const { io } = mkIO();

    await run({ kind: "question", text: "why does it need sunlight?" } as TeachRequest, mkCtx(), "u1", "c1", io);

    expect(fillChunk).toHaveBeenCalled(); // an in-corpus followup still gets answered
    expect(emitted(EVENTS.claimsVerified).length).toBeGreaterThanOrEqual(1); // ...but never unchecked
  });

  it("C2: continuing a lesson verifies chunk 2 — passages are a property of the LESSON, not the request", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L1" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ cursor: 3 })]); // an ACTIVE lesson must exist to continue
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ cursor: 3 })); // chunk 2 of a 9-slot lesson
    searchChunks.mockResolvedValue([chunk("c1", PASSAGE)]);
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "continue" }));
    vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([
      { index: 0, text: "Green plants use sunlight to make food from carbon dioxide and water.", provider: "fake", model: "m", ms: 1, tokens: 1, later: false, retry: false },
    ]));
    const { io } = mkIO();

    await run({ kind: "command", command: "continue" } as TeachRequest, mkCtx(), "u1", "c1", io);

    expect(searchChunks).toHaveBeenCalled(); // the lesson's passages are re-fetched for this request
    expect(emitted(EVENTS.claimsVerified).length).toBeGreaterThanOrEqual(1);
  });

  it("C1: an UNVERIFIABLE answer is held back too — an answer is evidence, not conversation", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L1" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson()]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson());
    searchChunks.mockResolvedValue([chunk("c1", PASSAGE)]);
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "followup" }));
    vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([
      { index: 0, text: "Green plants do not use sunlight to make food.", provider: "fake", model: "m", ms: 1, tokens: 1, later: false, retry: false },
    ]));
    const { io, writes } = mkIO();

    await run({ kind: "question", text: "does it need sunlight?" } as TeachRequest, mkCtx(), "u1", "c1", io);

    const text = JSON.stringify(writes);
    expect(text).toMatch(/re-checking that against the book/i);
    expect(text).not.toMatch(/do not use sunlight/i); // the contradiction never reaches the student
  });

  it("C1: the refusal is recorded as a routing decision, not just shown to the student", async () => {
    searchChunks.mockResolvedValue([]);
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "followup" }));
    const { io } = mkIO();

    await run({ kind: "question", text: "how do I pick a lock?" } as TeachRequest, mkCtx(), "u1", "c1", io);

    expect(emitted(EVENTS.capabilitySelected)).toContainEqual(
      expect.objectContaining({ capability: "RefuseOffSyllabus" }),
    );
  });

  it("C2: passages are fetched ONCE per subject per request — the outline pass primes the cache", async () => {
    searchChunks.mockResolvedValue([chunk("c1", PASSAGE)]);
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "topic" }));
    const { io } = mkIO();

    await run(mkReq("Photosynthesis"), mkCtx(), "u1", "c1", io);

    // The router's corpus gate and the outline pass each query once; fillSlots must reuse the cached
    // result rather than issuing a third identical query for the same subject.
    const forTopic = searchChunks.mock.calls.filter((c) => String(c[0]).trim() === "Photosynthesis");
    expect(forTopic.length).toBeLessThanOrEqual(2);
  });

  it("C2: an UNVERIFIABLE continuation block is held back, exactly as it would be in chunk 1", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L1" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ cursor: 3 })]); // an ACTIVE lesson must exist to continue
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ cursor: 3 }));
    searchChunks.mockResolvedValue([chunk("c1", PASSAGE)]);
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "continue" }));
    // Prose that contradicts the passage — must never reach the student, on any chunk.
    vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([
      { index: 0, text: "Green plants do not use sunlight to make food.", provider: "fake", model: "m", ms: 1, tokens: 1, later: false, retry: false },
    ]));
    const { io, writes } = mkIO();

    await run({ kind: "command", command: "continue" } as TeachRequest, mkCtx(), "u1", "c1", io);

    expect(JSON.stringify(writes)).toMatch(/re-checking that against the book/i);
    expect(vi.mocked(setSlotStates).mock.calls.at(-1)?.[1]).toContainEqual({ index: 3, state: "FAILED" });
  });
});
