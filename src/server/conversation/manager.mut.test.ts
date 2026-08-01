import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * conversation/manager `run()` — MUTATION-KILL suite (companion to manager.test.ts).
 *
 * Every test pins an EXACT observable value that a surviving Stryker mutant would
 * change: evidence-envelope fields (source/tier/provenance/conversationId/reqId),
 * the deterministic command→action routing for the UNCOVERED command paths
 * (`simpler`/`retry` with an active lesson), finishLesson outcome derivation for all
 * three outcomes + the null-lesson fallback, the exact answer prompts / interim
 * patches / status writes, the grounding fall-through guards, and the `?? ""` /
 * optional-chaining fallbacks. Faked ONLY at the I/O edge (db, repos, evidence,
 * advisors, grounding I/O, env flags) — all decision logic runs for real.
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
import { emit, emitMany, EVENTS, type EmitInput } from "@/server/events";
import type { OutlineSlot } from "@/server/conversation/outline";
import type { LessonState } from "@/server/conversation/lessonState";

// ── Mocks: fake ONLY at the I/O edge (identical to manager.test.ts). ──
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/log", () => ({ log: vi.fn() }));
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

// ── Fixtures / builders ──
type Ev = Record<string, unknown>;

function mkIO(signal?: AbortSignal): { io: TeachIO; writes: Ev[] } {
  const writes: Ev[] = [];
  const io: TeachIO = { write: (e: object) => { writes.push(e as Ev); }, signal: signal ?? new AbortController().signal, reqId: "req-1" };
  return { io, writes };
}
function mkReq(over: Partial<TeachRequest> = {}): TeachRequest {
  return { kind: "lesson", topic: "Photosynthesis", ...over } as TeachRequest;
}
function mkCtx(explanations = 0): TeachContext {
  return { topic: "", explanations: Array.from({ length: explanations }, (_v, i) => ({ regionId: `r${i}`, title: `t${i}`, kind: "lesson" })), selectedRegionId: null };
}
function mkSlots(n: number, failed: number[] = []): OutlineSlot[] {
  return Array.from({ length: n }, (_v, i) => ({
    slot: i + 1, type: i === 0 ? "heading" : i === n - 1 ? "summary" : "paragraph",
    intent: `slot ${i}`, state: failed.includes(i) ? "FAILED" : "READY",
  }));
}
function mkLesson(over: Partial<LessonRow> = {}): LessonRow {
  return { id: "L9", userId: "u1", canvasId: "c1", regionId: "reg1", topic: "Algebra", slots: mkSlots(9), cursor: 0, state: "TEACHING", ...over };
}
// ── Accessors ──
const wByT = (w: Ev[], t: string) => w.filter((e) => e.t === t);
const statuses = (w: Ev[]) => wByT(w, "status").map((e) => e.status as string);
const regions = (w: Ev[]) => wByT(w, "region").map((e) => e.title as string);
const blocks = (w: Ev[]) => wByT(w, "block").map((e) => e.block as { type: string; data: Record<string, unknown>; streamText?: string });
const patches = (w: Ev[]) => wByT(w, "patch") as unknown as { index: number; data: Record<string, unknown> }[];
const outcomes = (w: Ev[]) => wByT(w, "outcome");
const blockText = (w: Ev[]) => ((blocks(w)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
const emittedCall = (type: string) => vi.mocked(emit).mock.calls.find((c) => c[1] === type);
const emitted = (type: string) => vi.mocked(emit).mock.calls.filter((c) => c[1] === type).map((c) => c[2]);
const t1All = (): EmitInput[] => vi.mocked(emitMany).mock.calls.flatMap((c) => c[0]);
const t1 = (type: string) => t1All().filter((e) => e.type === type).map((e) => e.payload);
const setStates = () => vi.mocked(setLessonState).mock.calls.map((c) => c[1]);

const PROVENANCE = { promptVersion: "1.1.0", pipelineVersion: "conversation-v1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(providerChain).mockReturnValue([{ name: "fake" } as unknown as ProviderEntry]);
  vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: null });
  vi.mocked(getLessons).mockResolvedValue([]);
  vi.mocked(getLesson).mockResolvedValue(null);
  vi.mocked(createLesson).mockImplementation(async (userId, canvasId, topic, regionId, slots) => ({
    id: "L1", userId, canvasId, regionId, topic, slots, cursor: 0, state: "IDLE" as LessonState,
  }));
  vi.mocked(setActiveLesson).mockResolvedValue(undefined);
  vi.mocked(advanceCursor).mockResolvedValue(mkLesson());
  vi.mocked(setLessonState).mockResolvedValue(undefined);
  vi.mocked(setSlotStates).mockResolvedValue(undefined);
  vi.mocked(setCanvasMeta).mockResolvedValue(undefined);
  vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "topic" }));
  vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([]));
  vi.mocked(emit).mockResolvedValue("eid");
  vi.mocked(emitMany).mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Evidence envelope — meta()/ev()/t1() carry source + tier + provenance + ids.
// Kills: L54 (meta body), L55 (meta object), L59/L63 ("server"), L63 ({tier:1}),
//        L84 (provenance object + "conversation-v1"), L239/L174/L179 payloads.
// ─────────────────────────────────────────────────────────────────────────────
describe("run — evidence envelope (source/tier/provenance/ids)", () => {
  it("an ev() call stamps source='server' and the full provenance meta", async () => {
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);

    const call = emittedCall(EVENTS.outlinePlanned)!;
    expect(call[0]).toBe("u1");
    expect(call[3]).toBe("server"); // L59:40 — the source arg is exactly "server"
    // L54/L55/L84 — meta returns the real correlation object with real provenance.
    expect(call[4]).toEqual({ conversationId: "sess1", reqId: "req-1", lessonId: "L1", provenance: PROVENANCE });
  });

  it("a t1() event carries source='server', tier:1 and the same provenance meta", async () => {
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);

    const entry = t1All().find((e) => e.type === EVENTS.lessonStarted)!;
    expect(entry.source).toBe("server");        // L63:60
    expect(entry.tier).toBe(1);                  // L63:83 — { tier: 1, ...extra } is preserved
    expect(entry.conversationId).toBe("sess1");  // L55 conversationId
    expect(entry.reqId).toBe("req-1");           // L55 reqId
    expect(entry.lessonId).toBe("L1");           // L55 lessonId
    expect(entry.provenance).toEqual(PROVENANCE); // L84:17 + L84:67
  });

  it("outline.planned payload is the exact {slots:[{slot,type}...]}, not {} / undefined / {}[]", async () => {
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);

    const payload = emitted(EVENTS.outlinePlanned)[0] as { slots: { slot: number; type: string }[] };
    expect(Array.isArray(payload.slots)).toBe(true);          // L239:34 (payload not {})
    expect(payload.slots).toHaveLength(9);
    expect(payload.slots[0]).toEqual({ slot: 1, type: "heading" });  // L239:55 (arrow) + L239:63 (inner {})
    expect(payload.slots[8]).toEqual({ slot: 9, type: "summary" });
  });

  it("lesson.state and lesson.cursor payloads carry the real {from,to} / {cursor,advanced}", async () => {
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);

    expect(t1(EVENTS.lessonState)[0]).toEqual({ from: "IDLE", to: "PLANNING" }); // L174:31
    expect(t1(EVENTS.lessonCursor)[0]).toEqual({ cursor: 3, advanced: 3 });      // L179:32
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// request text derivation (line 88) — the ternary + the `?? ""` fallback.
// Kills: L88:20 (ConditionalExpression→true), L88:83 ("" → "Stryker…").
// ─────────────────────────────────────────────────────────────────────────────
describe("run — reqText derivation", () => {
  it("a lesson request records its TOPIC as the request text (not request.text)", async () => {
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);
    // L88:20 — kind!=="question" so reqText = request.topic, NOT request.text (undefined→"")
    expect(t1(EVENTS.requestReceived)[0]).toEqual({ kind: "lesson", text: "Photosynthesis", command: undefined });
  });

  it("a question with NO text falls back to '' (not the Stryker sentinel)", async () => {
    vi.mocked(providerChain).mockReturnValue([]); // short-circuit; requestReceived still emitted
    const { io } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: undefined as unknown as string }), mkCtx(), "u1", "c1", io);
    expect(t1(EVENTS.requestReceived)[0]).toEqual({ kind: "question", text: "", command: undefined }); // L88:83
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// turn count (line 81) — optional chaining on context / context.explanations.
// Kills: L81 both OptionalChaining mutants (context?. and explanations?.).
// ─────────────────────────────────────────────────────────────────────────────
describe("run — turn count optional chaining", () => {
  it("undefined context.explanations does NOT throw → turn 0 greeting", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "greeting" }));
    const badCtx = { topic: "", explanations: undefined, selectedRegionId: null } as unknown as TeachContext;
    const { io, writes } = mkIO();
    await expect(run(mkReq({ kind: "question", topic: "", text: "hi" }), badCtx, "u1", "c1", io)).resolves.toBeUndefined();
    expect(blockText(writes)).toBe("Hi — I'm Agabi. What would you like to learn?"); // turn 0 (explanations?.length ?? 0)
  });

  it("an undefined context object does NOT throw → turn 0 greeting", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "greeting" }));
    const { io, writes } = mkIO();
    await expect(run(mkReq({ kind: "question", topic: "", text: "hi" }), undefined as unknown as TeachContext, "u1", "c1", io)).resolves.toBeUndefined();
    expect(blockText(writes)).toBe("Hi — I'm Agabi. What would you like to learn?"); // turn 0 (context?.… ?? 0)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Command routing that is UNCOVERED elsewhere: simpler/retry WITH an active lesson.
// Kills: L140:45/53 (Simplify object+string), plus the retry command→object path.
// ─────────────────────────────────────────────────────────────────────────────
describe("run — command 'simpler' with an ACTIVE lesson → Simplify (no model classify)", () => {
  it("routes Simplify, re-teaches the last chunk, cycles SIMPLIFYING→WAITING, never advances cursor", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9", topic: "Fractions" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", topic: "Fractions", cursor: 5, slots: mkSlots(9), state: "WAITING_FOR_STUDENT" }));
    const { io } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "simpler" }), mkCtx(), "u1", "c1", io);

    expect(t1(EVENTS.commandSent)).toEqual([{ action: "Simplify" }]); // L140:53 "Simplify"; L140:45 object shape
    expect(classifyIntent).not.toHaveBeenCalled();                    // command path never classifies
    expect(setStates()).toEqual(["SIMPLIFYING", "WAITING_FOR_STUDENT"]);
    expect(advanceCursor).not.toHaveBeenCalled();
    const prompts = vi.mocked(fillChunk).mock.calls[0][2];
    expect(prompts.batchSystem).toContain("Explain it more simply than before");
  });

  it("simplify re-teaches the chunk starting at cursor-CHUNK (Math.max, minus, not min/plus)", async () => {
    // cursor 5, CHUNK 3 → start = max(0, 5-3) = 2 → slots 2,3,4 refilled.
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9", topic: "Fractions" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", topic: "Fractions", cursor: 5, slots: mkSlots(9), state: "WAITING_FOR_STUDENT" }));
    const { io } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "simpler" }), mkCtx(), "u1", "c1", io);

    const indices = vi.mocked(setSlotStates).mock.calls[0][1].map((u) => u.index);
    expect(indices).toEqual([2, 3, 4]); // L273:17 (max, not min→[0,1,2]) + L273:29 (minus, not plus→[8])
  });

  it("missing lesson on simplify → the 'no lesson to simplify' paragraph titled 'Agabi'", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(null);
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "simpler" }), mkCtx(), "u1", "c1", io);

    expect(regions(writes)).toEqual(["Agabi"]);            // L271:36 title
    expect(blockText(writes)).toBe("There's no lesson to simplify — pick a topic to start.");
    expect(fillChunk).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// decideAction text fallback (line 144) — `?? ""` fed to classifyIntent.
// Kills: L144:80 ("" → "Stryker…").
// ─────────────────────────────────────────────────────────────────────────────
describe("run — decideAction text fallback", () => {
  it("a lesson request with no topic classifies the empty string, not the Stryker sentinel", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "unclear" }));
    const { io } = mkIO();
    await run(mkReq({ kind: "lesson", topic: undefined as unknown as string }), mkCtx(), "u1", "c1", io);
    expect(classifyIntent).toHaveBeenCalledWith(""); // L144:80
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AskForTopic title (line 111) — the deterministic "Agabi" region.
// Kills: L111:40 ("Agabi" → "").
// ─────────────────────────────────────────────────────────────────────────────
describe("run — AskForTopic region title", () => {
  it("titles the region 'Agabi'", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "unclear" }));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "asdf" }), mkCtx(), "u1", "c1", io);
    expect(regions(writes)).toEqual(["Agabi"]);
    expect(blockText(writes)).toBe("What topic should we start with?");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Active-lesson resolution (line 101) — find MUST match on id, not return the first.
// Kills: L101:63 (ConditionalExpression→true inside lessons.find).
// ─────────────────────────────────────────────────────────────────────────────
describe("run — active lesson is resolved by id, not the first lesson", () => {
  it("continue picks the lesson whose id === activeLessonId (2nd), not lessons[0]", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L2" });
    vi.mocked(getLessons).mockResolvedValue([
      mkLesson({ id: "L1", topic: "First" }), mkLesson({ id: "L2", topic: "Second" }),
    ]);
    vi.mocked(getLesson).mockImplementation(async (id: string) =>
      id === "L2" ? mkLesson({ id: "L2", topic: "Second", cursor: 0, slots: mkSlots(9) }) : null);
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);

    expect(getLesson).toHaveBeenCalledWith("L2");
    expect(advanceCursor).toHaveBeenCalledWith("L2", 3); // NOT "L1"
    expect(outcomes(writes)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// continueLesson chunkEmitted transition (line 266) + missing-lesson title (253).
// Kills: L266:40 ("TEACHING"), L266:52 ("chunkEmitted"), L253:36 ("Agabi").
// ─────────────────────────────────────────────────────────────────────────────
describe("run — continueLesson state transitions", () => {
  it("a non-final chunk transitions TEACHING then back to WAITING_FOR_STUDENT (chunkEmitted)", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", cursor: 0, slots: mkSlots(9) }));
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);

    expect(setStates()).toEqual(["TEACHING", "WAITING_FOR_STUDENT"]); // L266:40/52 (illegal from/event would throw)
    expect(wByT(writes, "error")).toEqual([]); // no crash → real transition ran
  });

  it("missing lesson on continue → 'Agabi'-titled 'not here anymore' paragraph", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "Lx" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "Lx" })]);
    vi.mocked(getLesson).mockResolvedValue(null);
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);

    expect(regions(writes)).toEqual(["Agabi"]); // L253:36
    expect(blockText(writes)).toBe("That lesson isn't here anymore — pick a topic to start fresh.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// finishLesson (lines 186-187) — outcome→event derivation for COMPLETE/PARTIAL/FAILED
// and the null-lesson `?? []` / `lesson?.slots` guard.
// Kills: L186:25 (optional chaining), L186:42 ([] fallback), L187:30/70/84.
// ─────────────────────────────────────────────────────────────────────────────
describe("run — finishLesson outcome derivation", () => {
  function continueToFinish(slots: OutlineSlot[]) {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", cursor: 3, slots }));
  }

  it("all-READY final chunk → COMPLETE, state TEACHING→COMPLETED", async () => {
    continueToFinish(mkSlots(5));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);
    expect(outcomes(writes)[0]).toMatchObject({ outcome: "COMPLETE", plannedCount: 5, readyCount: 5, failedIndices: [] });
    expect(setStates().at(-1)).toBe("COMPLETED"); // event "complete"
  });

  it("one FAILED slot → PARTIAL, state TEACHING→PARTIAL (2nd ternary === PARTIAL, not fail)", async () => {
    continueToFinish(mkSlots(5, [4]));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);
    // L187:30 (1st cond not forced true→complete), L187:70 (2nd cond real), L187:84 ("PARTIAL" literal)
    expect(outcomes(writes)[0]).toMatchObject({ outcome: "PARTIAL", plannedCount: 5, readyCount: 4 });
    expect(setStates().at(-1)).toBe("PARTIAL");
  });

  it("all-FAILED final chunk → FAILED, state TEACHING→FAILED (2nd ternary false → fail)", async () => {
    continueToFinish(mkSlots(5, [0, 1, 2, 3, 4]));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);
    expect(outcomes(writes)[0]).toMatchObject({ outcome: "FAILED", plannedCount: 5, readyCount: 0 });
    expect(setStates().at(-1)).toBe("FAILED"); // L187:70 →true would give PARTIAL
  });

  it("finishLesson re-reads a now-missing lesson → scores [] → FAILED/0 (no throw, no COMPLETE/1)", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    // 1st getLesson (continueLesson) → valid; 2nd getLesson (finishLesson) → null.
    vi.mocked(getLesson)
      .mockResolvedValueOnce(mkLesson({ id: "L9", cursor: 3, slots: mkSlots(5) }))
      .mockResolvedValue(null);
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);

    // L186:25 — `lesson?.slots` (mutant `lesson.slots` would throw → no outcome, an error write).
    expect(outcomes(writes)).toHaveLength(1);
    // L186:42 — `?? []` (mutant `?? ["Stryker was here"]` scores planned:1 → COMPLETE).
    expect(outcomes(writes)[0]).toMatchObject({ outcome: "FAILED", plannedCount: 0, readyCount: 0, failedIndices: [] });
    expect(wByT(writes, "error")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retryLesson finish state — refills failed slots then re-scores (state assertions).
// Reinforces L187 across the retry entry (from PARTIAL/FAILED, not TEACHING).
// ─────────────────────────────────────────────────────────────────────────────
describe("run — retryLesson re-score state", () => {
  it("PARTIAL lesson, refill fails → stays PARTIAL (TEACHING→PARTIAL after retry)", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", state: "PARTIAL", slots: mkSlots(6, [3]) }));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "retry" }), mkCtx(), "u1", "c1", io);
    expect(setStates()).toEqual(["TEACHING", "PARTIAL"]); // retry re-opens, finish re-closes as PARTIAL
    expect(outcomes(writes)[0]).toMatchObject({ outcome: "PARTIAL" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startLesson status + grounding guards (lines 196, 201, 211, 220).
// Kills: L196:13/18/36 ("planning" status), L201:7 (KNOWLEDGE gate),
//        L211:7 / L220:7 (the `&&` fall-through guards — must stay AND).
// ─────────────────────────────────────────────────────────────────────────────
describe("run — startLesson status sequence (Phase-1 default teaching)", () => {
  it("writes the real status sequence for a default lesson (thinking→planning→generating→finished)", async () => {
    const { io, writes } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);
    expect(statuses(writes)).toEqual(["thinking", "planning", "generating", "finished"]);
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// Answer path (lines 280-303) — region/status/block writes, exact prompts, interim
// patch. Kills: L281:13/18/36, L286:148, L287:29/46, L290:13/18/34, L293:28/43/44/61,
//        L294:74, L297:27/50/96/101.
// ─────────────────────────────────────────────────────────────────────────────
describe("run — Answer path exact writes and prompts", () => {
  it("empty-canvas followup: status writes, paragraph skeleton block, exact memory-less prompt", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "followup" }));
    vi.mocked(fillChunk).mockImplementation(async (_slots, _chain, _prompts, sink) => {
      sink.onText(0, "partial…"); // interim onText patch (line 297)
      return advise<RawSlot[]>([{ index: 0, text: "Because chlorophyll absorbs light.", provider: "p", model: "m", tokens: 1, ms: 1, later: false, retry: false }]);
    });
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "why is that true?" }), mkCtx(), "u1", "c1", io);

    expect(regions(writes)).toEqual(["Question"]);
    expect(statuses(writes)).toEqual(["thinking", "generating", "finished"]); // L281:13/18/36 + finished

    // L287:29/46 + L290:13/18/34 — the skeleton block is a real paragraph doc.
    expect(blocks(writes)).toHaveLength(1);
    expect(blocks(writes)[0].type).toBe("paragraph");
    expect(blocks(writes)[0].data).toEqual({ doc: { type: "doc", content: [{ type: "paragraph", content: undefined }] } });

    // L297:27/50/96/101 — the interim onText patch is the streamed "partial…" as a paragraph doc.
    const interim = patches(writes)[0];
    expect(interim.index).toBe(0);
    expect(interim.data).toEqual({ doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "partial…" }] }] } });

    const prompts = vi.mocked(fillChunk).mock.calls[0][2];
    // L286:148 — no prior topics ⇒ memory is exactly "" (mutant injects the Stryker sentence).
    expect(prompts.perSlot[0].textUser).toBe("Answer this for a 14-16 year old in 2-3 clear sentences. Question: why is that true?");
  });

  it("answer keeps the ACTIVE topic (`?? text`, not `&& text`) in the batch/json prompts", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9", topic: "Trig" })]);
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "harder" }), mkCtx(), "u1", "c1", io);

    expect(regions(writes)).toEqual(["Trig"]);
    const prompts = vi.mocked(fillChunk).mock.calls[0][2];
    // L293:28 + L294:74 — `topic ?? text` uses the topic "Trig", not the command sentence.
    expect(prompts.batchUser.startsWith("Lesson topic: Trig.")).toBe(true);
    expect(prompts.perSlot[0].jsonUser.startsWith("Lesson topic: Trig.")).toBe(true);
    // L293:43/44/61 — the one paragraph slot is printed with its real type + intent.
    expect(prompts.batchUser).toContain("slot 0 — paragraph — Explain this in more depth for an advanced student.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error message derivation (line 126) — non-Error rejection → "unknown".
// Kills: L126:76 ("unknown" → "").
// ─────────────────────────────────────────────────────────────────────────────
describe("run — non-Error failure records 'unknown'", () => {
  it("a rejected non-Error value is logged as message:'unknown'", async () => {
    vi.mocked(createLesson).mockRejectedValue("boom-string"); // not an Error instance
    const { io, writes } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);
    expect(t1(EVENTS.error)).toEqual([{ message: "unknown" }]); // L126:76
    expect(writes.at(-1)).toEqual({ t: "done" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tier-1 buffer integrity (lines 68, 85) — the buffer starts empty and resets empty,
// so no sentinel string ever leaks into a flushed batch.
// Kills: L85:25 (initial buffer), L68:12 (reset buffer).
// ─────────────────────────────────────────────────────────────────────────────
describe("run — Tier-1 buffer contains only real events", () => {
  it("across a first-flush failure + catch re-flush, the batches are exactly the real events", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "greeting" }));
    vi.mocked(emitMany).mockRejectedValue(new Error("outbox dead"));
    const { io } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "hi" }), mkCtx(), "u1", "c1", io);

    // L85:25 (buffer would start with a sentinel) + L68:12 (reset would inject a sentinel).
    expect(t1All().map((e) => e && e.type)).toEqual([EVENTS.requestReceived, EVENTS.commandSent, EVENTS.error]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startLesson whitespace-topic trim happens upstream in resolveAction; covered here
// so the fillSlots slot.filled evidence shape is pinned end-to-end.
// Reinforces slot.filled / provider.used / slot.failed payload object literals.
// ─────────────────────────────────────────────────────────────────────────────
describe("run — fillSlots slot.filled evidence shape", () => {
  it("a filled heading slot emits the full slot.filled record (all fields real)", async () => {
    vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([
      { index: 0, text: "Photosynthesis", provider: "groq", model: "m7", tokens: 5, ms: 12, later: false, retry: false },
    ]));
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);

    const filled = emitted(EVENTS.slotFilled)[0] as Record<string, unknown>;
    expect(filled).toEqual({ slot: 0, provider: "groq", model: "m7", slotType: "heading", rung: 1, ok: true, ms: 12, tokens: 5 });
    expect(emitted(EVENTS.providerUsed)[0]).toEqual({ provider: "groq", chunkStart: 0 });
    // slots 1 & 2 never returned → FAILED with the real slot.failed shape.
    const failed = (emitted(EVENTS.slotFailed) as { slot: number; slotType: string; reason: string }[]).sort((a, b) => a.slot - b.slot);
    expect(failed[0]).toMatchObject({ slot: 1, reason: "minimal/unfilled" });
  });
});
