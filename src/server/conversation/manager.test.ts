import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * conversation/manager `run()` — the deterministic teaching orchestrator.
 *
 * WHAT IS FAKED (I/O edge ONLY, per §H1.7): the DB writers (`lessonRepo`,
 * `canvasRepo`, `context`), the evidence sinks (`events.emit`/`emitMany`, `log`),
 * the LLM advisors (`intent.classifyIntent`, `chunk.fillChunk`), the provider chain,
 * the grounding I/O (`groundedOutline`/`sourceGroundedOutline`/`webGroundedOutline`
 * + `defaultKnowledgeStore`), the web search, the three env grounding FLAGS, and
 * `@/server/db` (so no PrismaClient is constructed).
 *
 * WHAT IS REAL (all decision logic is exercised for real): action routing
 * (`decideAction`/`resolveAction`), `smallTalkReply`, the lesson state machine
 * (`transition`), `chooseOutline` + `defaultOutline` + `repairOutline`, `buildSkeleton`,
 * `coerceSlot`, `adaptBlock`, `scoreLesson`, `accept` + the real zod schemas,
 * `noRepeatForLesson`, `commandText`, and every prompt builder. Assertions name the
 * exact wire event / evidence payload / repo-call argument, never "it ran".
 */

import type { TeachRequest, TeachContext } from "@contract/schemas";
import { run, type TeachIO } from "@/server/conversation/manager";
import {
  getSession, getLessons, getLesson, createLesson, setActiveLesson,
  advanceCursor, setLessonState, setSlotStates, type LessonRow,
} from "@/server/conversation/lessonRepo";
import { setCanvasMeta } from "@/server/conversation/canvasRepo";
import { buildCanvasContext } from "@/server/conversation/context";
import { providerChain, type ProviderEntry } from "@/server/advisors/providers";
import { classifyIntent, type IntentAdvice } from "@/server/advisors/intent";
import { fillChunk, type RawSlot } from "@/server/advisors/chunk";
import { advise } from "@/server/advisors/advice";
import { emit, emitMany, EVENTS } from "@/server/events";
import { groundedOutline, sourceGroundedOutline, type GroundedOutline } from "@/server/conversation/grounding";
import { webGroundedOutline } from "@/server/retrieval/web";
import { KNOWLEDGE_GROUNDING_ON, SOURCE_GROUNDING_ON, WEB_GROUNDING_ON } from "@/env";
import { log } from "@/server/log";
import type { OutlineSlot } from "@/server/conversation/outline";
import type { LessonState } from "@/server/conversation/lessonState";

// ── Mocks: fake ONLY at the I/O edge (db, repos, evidence, advisors, grounding I/O, env flags). ──
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/log", () => ({ log: vi.fn() }));
vi.mock("@/server/conversation/lessonRepo", () => ({
  getSession: vi.fn(), getLessons: vi.fn(), getLesson: vi.fn(), createLesson: vi.fn(),
  setActiveLesson: vi.fn(), advanceCursor: vi.fn(), setLessonState: vi.fn(), setSlotStates: vi.fn(),
}));
vi.mock("@/server/conversation/canvasRepo", () => ({ setCanvasMeta: vi.fn() }));
vi.mock("@/server/conversation/context", () => ({ buildCanvasContext: vi.fn() }));
vi.mock("@/server/advisors/providers", () => ({ providerChain: vi.fn() }));
vi.mock("@/server/retrieval/web", () => ({ webGroundedOutline: vi.fn(), tavilySearch: vi.fn() }));

// Partial mocks: keep the REAL validating schemas / EVENTS map / chooseOutline; stub only the I/O fn.
vi.mock("@/server/advisors/intent", async (io: () => Promise<typeof import("@/server/advisors/intent")>) => ({
  ...(await io()), classifyIntent: vi.fn(),
}));
vi.mock("@/server/advisors/chunk", async (io: () => Promise<typeof import("@/server/advisors/chunk")>) => ({
  ...(await io()), fillChunk: vi.fn(),
}));
vi.mock("@/server/events", async (io: () => Promise<typeof import("@/server/events")>) => ({
  ...(await io()), emit: vi.fn(), emitMany: vi.fn(),
}));
vi.mock("@/server/conversation/grounding", async (io: () => Promise<typeof import("@/server/conversation/grounding")>) => ({
  ...(await io()), groundedOutline: vi.fn(), sourceGroundedOutline: vi.fn(), defaultKnowledgeStore: vi.fn(),
}));
vi.mock("@/env", async (io: () => Promise<typeof import("@/env")>) => ({
  ...(await io()), KNOWLEDGE_GROUNDING_ON: vi.fn(), SOURCE_GROUNDING_ON: vi.fn(), WEB_GROUNDING_ON: vi.fn(),
}));

// ── Fixtures / builders ──
type Ev = Record<string, unknown>;

function mkIO(signal?: AbortSignal): { io: TeachIO; writes: Ev[] } {
  const writes: Ev[] = [];
  const io: TeachIO = { write: (e: object) => { writes.push(e as Ev); }, signal: signal ?? new AbortController().signal, reqId: "req-1" };
  return { io, writes };
}
function mkReq(over: Partial<TeachRequest> = {}): TeachRequest {
  return { kind: "lesson", topic: "Photosynthesis", ...over };
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
function groundedOf(outline: OutlineSlot[], over: Partial<GroundedOutline> = {}): GroundedOutline {
  return { outline, conceptIds: ["c1"], promptVersion: "grounded-outline@1", assetCount: 2, ...over };
}
const CLEAN_GROUNDED: OutlineSlot[] = [
  { slot: 1, type: "heading", intent: "H" }, { slot: 2, type: "table", intent: "T" },
  { slot: 3, type: "paragraph", intent: "P" }, { slot: 4, type: "chart", intent: "C" },
  { slot: 5, type: "paragraph", intent: "P2" }, { slot: 6, type: "mindmap", intent: "M" },
  { slot: 7, type: "summary", intent: "S" },
];
const DIRTY_GROUNDED: OutlineSlot[] = [
  { slot: 1, type: "paragraph", intent: "one" }, { slot: 2, type: "paragraph", intent: "two" },
  { slot: 3, type: "table", intent: "three" }, { slot: 4, type: "paragraph", intent: "four" },
  { slot: 5, type: "chart", intent: "five" }, { slot: 6, type: "paragraph", intent: "six" },
];

// ── Accessors ──
const wByT = (w: Ev[], t: string) => w.filter((e) => e.t === t);
const statuses = (w: Ev[]) => wByT(w, "status").map((e) => e.status as string);
const regions = (w: Ev[]) => wByT(w, "region").map((e) => e.title as string);
const blocks = (w: Ev[]) => wByT(w, "block").map((e) => e.block as { type: string; data: Record<string, unknown>; streamText?: string });
const patches = (w: Ev[]) => wByT(w, "patch") as unknown as { index: number; data: Record<string, unknown> }[];
const outcomes = (w: Ev[]) => wByT(w, "outcome");
const emitted = (type: string) => vi.mocked(emit).mock.calls.filter((c) => c[1] === type).map((c) => c[2]);
const t1All = () => vi.mocked(emitMany).mock.calls.flatMap((c) => c[0]);
const t1 = (type: string) => t1All().filter((e) => e.type === type).map((e) => e.payload);

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
  vi.mocked(buildCanvasContext).mockResolvedValue({ canvasId: "c1", currentLesson: null, focusedRegionId: null, previousLessons: [] });
  vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "topic" }));
  vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([]));
  vi.mocked(emit).mockResolvedValue("eid");
  vi.mocked(emitMany).mockResolvedValue([]);
  vi.mocked(groundedOutline).mockResolvedValue(null);
  vi.mocked(sourceGroundedOutline).mockResolvedValue(null);
  vi.mocked(webGroundedOutline).mockResolvedValue(null);
  vi.mocked(KNOWLEDGE_GROUNDING_ON).mockReturnValue(false);
  vi.mocked(SOURCE_GROUNDING_ON).mockReturnValue(false);
  vi.mocked(WEB_GROUNDING_ON).mockReturnValue(false);
});

describe("run — no model configured (empty provider chain)", () => {
  it("writes the exact error sequence, buffers request.received + error, never touches the DB", async () => {
    vi.mocked(providerChain).mockReturnValue([]);
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "question", topic: "", text: "hi" }), mkCtx(), "u1", "c1", io);

    expect(writes).toEqual([
      { t: "status", status: "thinking" },
      { t: "status", status: "error" },
      { t: "error", recoverable: true, message: "No model configured. Add a free key (GROQ_API_KEY) or run Ollama." },
      { t: "done" },
    ]);
    expect(t1(EVENTS.requestReceived)).toEqual([{ kind: "question", text: "hi", command: undefined }]);
    expect(t1(EVENTS.error)).toEqual([{ message: "no model configured" }]);
    expect(createLesson).not.toHaveBeenCalled();
    expect(fillChunk).not.toHaveBeenCalled();
  });
});

describe("run — deterministic smalltalk (Greet) never calls the model", () => {
  it("emits the REAL smallTalkReply for a bare greeting as an adapted paragraph, routes 'Greet'", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "greeting" }));
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "question", topic: "", text: "hi" }), mkCtx(0), "u1", "c1", io);

    expect(regions(writes)).toEqual(["Agabi"]);
    expect(statuses(writes)).toEqual(["thinking", "generating", "finished"]);
    // turn 0 → the FIRST default greeting variant, adapted into a ProseMirror paragraph doc.
    expect(blocks(writes)).toEqual([{
      type: "paragraph",
      data: { doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi — I'm Agabi. What would you like to learn?" }] }] } },
    }]);
    expect(t1(EVENTS.commandSent)).toEqual([{ action: "Greet" }]);
    expect(fillChunk).not.toHaveBeenCalled();
  });

  it("turn count from context rotates the phrasing (no verbatim repeat)", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "greeting" }));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "hi" }), mkCtx(1), "u1", "c1", io);
    const text = ((blocks(writes)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
    expect(text).toBe('Hey again! Tell me a topic — like "real numbers" or "photosynthesis" — and I\'ll teach it.');
  });

  it("unclear intent → AskForTopic prompt", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "unclear" }));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "asdf" }), mkCtx(), "u1", "c1", io);
    const text = ((blocks(writes)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
    expect(text).toBe("What topic should we start with?");
    expect(t1(EVENTS.commandSent)).toEqual([{ action: "AskForTopic" }]);
  });

  it("invalid advice (fails IntentAdviceSchema) collapses to unclear → AskForTopic", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ nonsense: true } as unknown as IntentAdvice));
    const { io } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "???" }), mkCtx(), "u1", "c1", io);
    expect(t1(EVENTS.commandSent)).toEqual([{ action: "AskForTopic" }]);
  });
});

describe("run — command routing in decideAction (no model call)", () => {
  it("'continue' with an active lesson → ContinueLesson (teaches the next chunk)", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9", topic: "Algebra" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", cursor: 0, slots: mkSlots(9) }));
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);

    expect(t1(EVENTS.commandSent)).toEqual([{ action: "ContinueLesson" }]);
    expect(classifyIntent).not.toHaveBeenCalled(); // command path never asks the intent advisor
    expect(advanceCursor).toHaveBeenCalledWith("L9", 3);
    expect(outcomes(writes)).toEqual([]); // 3 of 9 → not finished
  });

  it("'continue' with NO active lesson → AskForTopic", async () => {
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);
    const text = ((blocks(writes)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
    expect(text).toBe("What topic should we start with?");
  });

  it("'simpler' with no active lesson → AskForTopic; 'retry' with no active → AskForTopic", async () => {
    for (const command of ["simpler", "retry"]) {
      vi.clearAllMocks();
      vi.mocked(providerChain).mockReturnValue([{ name: "fake" } as unknown as ProviderEntry]);
      vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: null });
      vi.mocked(getLessons).mockResolvedValue([]);
      vi.mocked(emitMany).mockResolvedValue([]);
      const { io, writes } = mkIO();
      await run(mkReq({ kind: "command", topic: "", command }), mkCtx(), "u1", "c1", io);
      const text = ((blocks(writes)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
      expect(text).toBe("What topic should we start with?");
    }
  });

  it("a known non-lifecycle command ('harder') → Answer, with the REAL commandText in the prompt", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9", topic: "Trig" })]);
    const { io, writes } = mkIO();

    await run(mkReq({ kind: "command", topic: "", command: "harder" }), mkCtx(), "u1", "c1", io);

    expect(t1(EVENTS.commandSent)).toEqual([{ action: "Answer" }]);
    expect(regions(writes)).toEqual(["Trig"]); // Answer titles the region by the active topic
    const prompts = vi.mocked(fillChunk).mock.calls[0][2];
    expect(prompts.perSlot[0].textUser).toContain("Explain this in more depth for an advanced student.");
  });

  it("an UNKNOWN command falls back to the generic Answer text and a null topic → 'Question' region", async () => {
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "zzz" }), mkCtx(), "u1", "c1", io);
    expect(regions(writes)).toEqual(["Question"]);
    const prompts = vi.mocked(fillChunk).mock.calls[0][2];
    expect(prompts.perSlot[0].textUser).toContain("Tell me more about this.");
  });
});

describe("run — StartLesson (grounding OFF, the Phase-1 default path)", () => {
  it("plans the real defaultOutline, persists it, streams skeleton, advances by CHUNK, stamps canvas meta", async () => {
    const { io, writes } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);

    // First lesson on the canvas → canvas identity stamped once (real classifySubject → "Biology").
    expect(setCanvasMeta).toHaveBeenCalledWith("u1", "c1", { title: "Photosynthesis", subject: "Biology" });

    // createLesson got the real 9-slot default outline; the region streamed its skeleton.
    const created = vi.mocked(createLesson).mock.calls[0];
    expect(created[2]).toBe("Photosynthesis");
    expect((created[4] as OutlineSlot[]).length).toBe(9);
    expect(regions(writes)).toEqual(["Photosynthesis"]);
    // Skeleton of the first CHUNK (heading, paragraph, mindmap) — real buildSkeleton/adaptBlock output.
    expect(blocks(writes).map((b) => b.type)).toEqual(["heading", "paragraph", "mindmap"]);
    expect(blocks(writes)[2].data).toEqual({ markdown: "# the core structure of Photosynthesis" });

    // State machine: IDLE→PLANNING→TEACHING (start) then TEACHING→WAITING (chunkEmitted); NOT finished.
    expect(vi.mocked(setLessonState).mock.calls.map((c) => c[1])).toEqual(["PLANNING", "TEACHING", "WAITING_FOR_STUDENT"]);
    expect(advanceCursor).toHaveBeenCalledWith("L1", 3);
    expect(outcomes(writes)).toEqual([]);
    expect(setActiveLesson).toHaveBeenCalledWith("u1", "c1", "L1");

    // Evidence: lesson.started stamps grounded=false + the real slot count; outline.planned emitted.
    expect(t1(EVENTS.lessonStarted)[0]).toMatchObject({ topic: "Photosynthesis", routing: "StartLesson", slots: 9, grounded: false, conceptIds: [], promptVersion: "1.1.0" });
    expect(emitted(EVENTS.outlinePlanned)).toHaveLength(1);
    expect(emitted(EVENTS.outlineRepaired)).toHaveLength(0); // default outline needs no repair
  });

  it("does NOT re-stamp canvas meta when the canvas already has lessons", async () => {
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L0", topic: "Old" })]);
    const { io } = mkIO();
    await run(mkReq({ topic: "Trigonometry" }), mkCtx(), "u1", "c1", io);
    expect(setCanvasMeta).not.toHaveBeenCalled();
  });

  it("a blank topic is coerced to 'this idea'", async () => {
    const { io } = mkIO();
    await run(mkReq({ topic: "   " }), mkCtx(), "u1", "c1", io);
    expect(vi.mocked(createLesson).mock.calls[0][2]).toBe("this idea");
  });

  it("no-repeat memory fires when the SAME topic was already taught (different lesson id)", async () => {
    vi.mocked(buildCanvasContext).mockResolvedValue({
      canvasId: "c1", currentLesson: null, focusedRegionId: null,
      previousLessons: [{ id: "L0", topic: "Photosynthesis", regionId: "r0", state: "COMPLETED", coveredTypes: ["mindmap"] }],
    });
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);
    const prompts = vi.mocked(fillChunk).mock.calls[0][2];
    expect(prompts.batchSystem).toContain("ALREADY taught this topic");
    expect(prompts.batchSystem).toContain("use DIFFERENT visuals this time");
  });
});

describe("run — StartLesson, fillSlots content ladder (real coerce/adapt/rung logic)", () => {
  it("fills every slot: patches, slot.filled evidence (rung 1), provider.used, all READY", async () => {
    vi.mocked(fillChunk).mockImplementation(async (_slots, _chain, _prompts, sink) => {
      sink.onText(1, "streaming para");            // interim text patch
      sink.onSlot(2, { markdown: "# live" });      // interim visual patch (real coerce)
      return advise<RawSlot[]>([
        { index: 0, text: "Photosynthesis", provider: "groq", model: "m", tokens: 5, ms: 10, later: false, retry: false },
        { index: 1, text: "It converts light to energy.", provider: "groq", model: "m", tokens: 5, ms: 10, later: false, retry: false },
        { index: 2, data: { markdown: "# core\n## light" }, provider: "groq", model: "m", tokens: 5, ms: 10, later: false, retry: false },
      ]);
    });
    const { io, writes } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);

    // three slot.filled events, rung 1 each, correct absolute slot numbers + provider
    const filled = emitted(EVENTS.slotFilled) as { slot: number; provider: string; rung: number; ok: boolean }[];
    expect(filled.map((f) => f.slot)).toEqual([0, 1, 2]);
    expect(filled.every((f) => f.rung === 1 && f.ok === true && f.provider === "groq")).toBe(true);
    // the final authoritative patch for slot 0 is the adapted heading doc
    const p0 = patches(writes).filter((p) => p.index === 0).at(-1)!;
    expect(p0.data).toEqual({ doc: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Photosynthesis" }] }] } });
    // every slot in the chunk reached READY; provider.used stamped at the chunk start
    expect(vi.mocked(setSlotStates).mock.calls[0][1]).toEqual([{ index: 0, state: "READY" }, { index: 1, state: "READY" }, { index: 2, state: "READY" }]);
    expect(emitted(EVENTS.providerUsed)).toEqual([{ provider: "groq", chunkStart: 0 }]);
    expect(emitted(EVENTS.slotFailed)).toHaveLength(0);
  });

  it("computes rung 2 (later), rung 3 (retry) and rung 4 (repaired) distinctly", async () => {
    vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([
      { index: 0, text: "H", provider: "p2", model: "m", tokens: 0, ms: 0, later: true, retry: false },  // clean + later → 2
      { index: 1, text: "P", provider: "p1", model: "m", tokens: 0, ms: 0, later: false, retry: true },  // clean + retry → 3
      { index: 2, text: "leaf", provider: "p1", model: "m", tokens: 0, ms: 0, later: false, retry: false }, // mindmap, text-only → coerce "repaired" → 4
    ]));
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);
    const rungs = (emitted(EVENTS.slotFilled) as { slot: number; rung: number }[]);
    expect(rungs.find((r) => r.slot === 0)!.rung).toBe(2);
    expect(rungs.find((r) => r.slot === 1)!.rung).toBe(3);
    expect(rungs.find((r) => r.slot === 2)!.rung).toBe(4);
    expect(emitted(EVENTS.providerUsed)).toEqual([{ provider: "p2", chunkStart: 0 }]); // first served
  });

  it("a coerce-minimal raw and an out-of-range index are skipped → that slot stays FAILED", async () => {
    vi.mocked(fillChunk).mockResolvedValue(advise<RawSlot[]>([
      { index: 0, text: "H", provider: "p", model: "m", tokens: 0, ms: 0, later: false, retry: false }, // ok
      { index: 2, data: {}, text: "", provider: "p", model: "m", tokens: 0, ms: 0, later: false, retry: false }, // mindmap empty → minimal → skipped
      { index: 99, text: "ghost", provider: "p", model: "m", tokens: 0, ms: 0, later: false, retry: false }, // out of range → skipped
    ]));
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);
    expect(vi.mocked(setSlotStates).mock.calls[0][1]).toEqual([
      { index: 0, state: "READY" }, { index: 1, state: "FAILED" }, { index: 2, state: "FAILED" },
    ]);
    const failedSlots = (emitted(EVENTS.slotFailed) as { slot: number }[]).map((f) => f.slot).sort((a, b) => a - b);
    expect(failedSlots).toEqual([1, 2]);
  });
});

describe("run — StartLesson with grounding flags ON (stubbed grounding I/O)", () => {
  it("KNOWLEDGE on + a grounded outline (assets>0) → grounded=true, conceptIds recorded, no miss events", async () => {
    vi.mocked(KNOWLEDGE_GROUNDING_ON).mockReturnValue(true);
    vi.mocked(groundedOutline).mockResolvedValue(groundedOf(CLEAN_GROUNDED, { conceptIds: ["c1", "c2"], assetCount: 3 }));
    const { io } = mkIO();
    await run(mkReq({ topic: "Cells" }), mkCtx(), "u1", "c1", io);

    expect((vi.mocked(createLesson).mock.calls[0][4] as OutlineSlot[]).length).toBe(7); // the grounded outline, unrepaired
    expect(t1(EVENTS.lessonStarted)[0]).toMatchObject({ grounded: true, conceptIds: ["c1", "c2"], promptVersion: "grounded-outline@1", slots: 7 });
    expect(emitted(EVENTS.teachingMiss)).toHaveLength(0);
    expect(emitted(EVENTS.knowledgeMiss)).toHaveLength(0);
    expect(emitted(EVENTS.outlineRepaired)).toHaveLength(0);
  });

  it("KNOWLEDGE on but the grounded outline carries ZERO assets → teaching.miss", async () => {
    vi.mocked(KNOWLEDGE_GROUNDING_ON).mockReturnValue(true);
    vi.mocked(groundedOutline).mockResolvedValue(groundedOf(CLEAN_GROUNDED, { assetCount: 0 }));
    const { io } = mkIO();
    await run(mkReq({ topic: "Cells" }), mkCtx(), "u1", "c1", io);
    expect(emitted(EVENTS.teachingMiss)).toEqual([{ topic: "Cells" }]);
    expect(emitted(EVENTS.knowledgeMiss)).toHaveLength(0); // grounded truthy → no knowledge.miss
  });

  it("KNOWLEDGE on but groundedOutline THROWS → falls back to default + emits knowledge.miss", async () => {
    vi.mocked(KNOWLEDGE_GROUNDING_ON).mockReturnValue(true);
    vi.mocked(groundedOutline).mockRejectedValue(new Error("graph down"));
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);
    expect((vi.mocked(createLesson).mock.calls[0][4] as OutlineSlot[]).length).toBe(9); // default
    expect(t1(EVENTS.lessonStarted)[0]).toMatchObject({ grounded: false });
    expect(emitted(EVENTS.knowledgeMiss)).toEqual([{ topic: "Photosynthesis" }]);
  });

  it("SOURCE on (knowledge miss) + a DIRTY grounded outline → repaired + outline.repaired evidence", async () => {
    vi.mocked(SOURCE_GROUNDING_ON).mockReturnValue(true);
    vi.mocked(sourceGroundedOutline).mockResolvedValue(groundedOf(DIRTY_GROUNDED));
    const { io } = mkIO();
    await run(mkReq({ topic: "Osmosis" }), mkCtx(), "u1", "c1", io);

    expect(sourceGroundedOutline).toHaveBeenCalled();
    const outline = vi.mocked(createLesson).mock.calls[0][4] as OutlineSlot[];
    expect(outline[0].type).toBe("heading");                       // repair forced the bookends
    expect(outline[outline.length - 1].type).toBe("summary");
    expect(emitted(EVENTS.outlineRepaired)).toHaveLength(1);
    expect(emitted(EVENTS.knowledgeMiss)).toHaveLength(0);         // knowledge flag off → no knowledge.miss
  });

  it("SOURCE on but sourceGroundedOutline THROWS → default outline, no crash", async () => {
    vi.mocked(SOURCE_GROUNDING_ON).mockReturnValue(true);
    vi.mocked(sourceGroundedOutline).mockRejectedValue(new Error("rag down"));
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);
    expect((vi.mocked(createLesson).mock.calls[0][4] as OutlineSlot[]).length).toBe(9);
  });

  it("WEB on (graph+source miss) → webGroundedOutline result is used", async () => {
    vi.mocked(WEB_GROUNDING_ON).mockReturnValue(true);
    vi.mocked(webGroundedOutline).mockResolvedValue(groundedOf(CLEAN_GROUNDED, { promptVersion: "web-grounded@1" }));
    const { io } = mkIO();
    await run(mkReq({ topic: "Meme theory" }), mkCtx(), "u1", "c1", io);
    expect(webGroundedOutline).toHaveBeenCalled();
    expect((vi.mocked(createLesson).mock.calls[0][4] as OutlineSlot[]).length).toBe(7);
    expect(t1(EVENTS.lessonStarted)[0]).toMatchObject({ grounded: true, promptVersion: "web-grounded@1" });
  });

  it("WEB on but webGroundedOutline THROWS → default outline", async () => {
    vi.mocked(WEB_GROUNDING_ON).mockReturnValue(true);
    vi.mocked(webGroundedOutline).mockRejectedValue(new Error("net down"));
    const { io } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);
    expect((vi.mocked(createLesson).mock.calls[0][4] as OutlineSlot[]).length).toBe(9);
  });
});

describe("run — ContinueLesson", () => {
  it("missing lesson → a friendly 'not here anymore' paragraph, no teaching", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "Lx" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "Lx" })]);
    vi.mocked(getLesson).mockResolvedValue(null);
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);
    const text = ((blocks(writes)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
    expect(text).toBe("That lesson isn't here anymore — pick a topic to start fresh.");
    expect(fillChunk).not.toHaveBeenCalled();
  });

  it("cursor already past the end → 'that's the whole lesson' message", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", topic: "Vectors", cursor: 5, slots: mkSlots(5) }));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);
    expect(regions(writes)).toEqual(["Vectors"]);
    const text = ((blocks(writes)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
    expect(text).toBe("That's the whole lesson on Vectors. Ask a question, or start a new topic.");
    expect(setActiveLesson).toHaveBeenCalledWith("u1", "c1", "L9");
  });

  it("last chunk reaches the end → finishLesson emits a COMPLETE outcome", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", cursor: 3, slots: mkSlots(5) })); // all READY
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "continue" }), mkCtx(), "u1", "c1", io);

    expect(advanceCursor).toHaveBeenCalledWith("L9", 2); // min(CHUNK, 5-3)
    expect(outcomes(writes)).toEqual([{ t: "outcome", outcome: "COMPLETE", failedIndices: [], plannedCount: 5, readyCount: 5 }]);
    expect(t1(EVENTS.lessonFinished)[0]).toMatchObject({ outcome: "COMPLETE", plannedCount: 5, readyCount: 5, failedIndices: [] });
    // TEACHING → COMPLETED (last transition), NOT chunkEmitted
    expect(vi.mocked(setLessonState).mock.calls.at(-1)![1]).toBe("COMPLETED");
  });
});

describe("run — Simplify", () => {
  it("action Simplify but the lesson row is gone → 'no lesson to simplify'", async () => {
    // Active ref exists (so resolveAction → Simplify), but getLesson finds nothing.
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "clarification" }));
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(null);
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "i don't get it" }), mkCtx(), "u1", "c1", io);
    const text = ((blocks(writes)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
    expect(text).toBe("There's no lesson to simplify — pick a topic to start.");
    expect(fillChunk).not.toHaveBeenCalled();
  });

  it("re-teaches the LAST chunk with a 'simpler' directive and cycles the state machine", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "clarification" }));
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", cursor: 5, slots: mkSlots(9), state: "WAITING_FOR_STUDENT" }));
    const { io } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "i don't get it" }), mkCtx(), "u1", "c1", io);

    // SIMPLIFYING then back to WAITING_FOR_STUDENT; cursor is NOT advanced.
    expect(vi.mocked(setLessonState).mock.calls.map((c) => c[1])).toEqual(["SIMPLIFYING", "WAITING_FOR_STUDENT"]);
    expect(advanceCursor).not.toHaveBeenCalled();
    const prompts = vi.mocked(fillChunk).mock.calls[0][2];
    expect(prompts.batchSystem).toContain("Explain it more simply than before");
  });
});

describe("run — SwitchLesson (intent switch_topic)", () => {
  it("matches a past lesson by topic, sets it active, and continues it", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "switch_topic", target: "algebra" }));
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "La", topic: "Algebra" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "La", topic: "Algebra", cursor: 0, slots: mkSlots(9) }));
    const { io } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "go back to algebra" }), mkCtx(), "u1", "c1", io);

    expect(t1(EVENTS.commandSent)).toEqual([{ action: "SwitchLesson" }]);
    expect(setActiveLesson).toHaveBeenCalledWith("u1", "c1", "La"); // set active, then continueLesson re-sets it
    expect(advanceCursor).toHaveBeenCalledWith("La", 3);
  });
});

describe("run — Answer (followup, with the canvas-memory seam)", () => {
  it("null topic + empty canvas → 'Question' region, empty memory, patches the streamed answer", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "followup" }));
    vi.mocked(fillChunk).mockImplementation(async (_slots, _chain, _prompts, sink) => {
      sink.onText(0, "partial…");
      return advise<RawSlot[]>([{ index: 0, text: "Because chlorophyll absorbs light.", provider: "p", model: "m", tokens: 1, ms: 1, later: false, retry: false }]);
    });
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "why is that true?" }), mkCtx(), "u1", "c1", io);

    expect(regions(writes)).toEqual(["Question"]);
    const last = patches(writes).at(-1)!;
    expect(last.index).toBe(0);
    expect(last.data).toEqual({ doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Because chlorophyll absorbs light." }] }] } });
    const prompts = vi.mocked(fillChunk).mock.calls[0][2];
    expect(prompts.perSlot[0].textUser).toContain("Question: why is that true?");
    expect(prompts.perSlot[0].textUser).not.toContain("So far on this canvas");
  });

  it("prior lessons on the canvas → the memory sentence is threaded into the prompt", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "followup" }));
    vi.mocked(buildCanvasContext).mockResolvedValue({
      canvasId: "c1", focusedRegionId: "reg1",
      currentLesson: mkLesson({ id: "Lc", topic: "Algebra" }),
      previousLessons: [{ id: "Lp", topic: "Trigonometry", regionId: "rp", state: "COMPLETED", coveredTypes: ["formula"] }],
    });
    const { io } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "recap?" }), mkCtx(), "u1", "c1", io);
    const prompts = vi.mocked(fillChunk).mock.calls[0][2];
    expect(prompts.perSlot[0].textUser).toContain("So far on this canvas the student has studied: Algebra, Trigonometry.");
  });
});

describe("run — RetryLesson", () => {
  it("missing lesson → 'not here anymore'", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "topic" }));
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(null);
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "retry" }), mkCtx(), "u1", "c1", io);
    const text = ((blocks(writes)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
    expect(text).toBe("That lesson isn't here anymore — pick a topic to start fresh.");
  });

  it("nothing FAILED → 'nothing to retry', no refill", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", topic: "Ratios", slots: mkSlots(9) })); // all READY
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "retry" }), mkCtx(), "u1", "c1", io);
    const text = ((blocks(writes)[0].data.doc as { content: { content: { text: string }[] }[] }).content[0].content[0]).text;
    expect(text).toBe("Nothing to retry — every section came through.");
    expect(fillChunk).not.toHaveBeenCalled();
  });

  it("refills ONLY the failed slots and re-scores → PARTIAL outcome", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", state: "PARTIAL", slots: mkSlots(6, [3]) }));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "retry" }), mkCtx(), "u1", "c1", io);

    // PARTIAL → TEACHING (retry), then fillSlots over ONLY slot index 3, then re-score.
    expect(vi.mocked(setLessonState).mock.calls[0][1]).toBe("TEACHING");
    expect(vi.mocked(setSlotStates).mock.calls[0][1]).toEqual([{ index: 3, state: "FAILED" }]); // refill produced nothing → still FAILED
    expect(outcomes(writes)).toEqual([{ t: "outcome", outcome: "PARTIAL", failedIndices: [4], plannedCount: 6, readyCount: 5 }]);
  });

  it("all slots FAILED → FAILED outcome", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: "sess1", activeLessonId: "L9" });
    vi.mocked(getLessons).mockResolvedValue([mkLesson({ id: "L9" })]);
    vi.mocked(getLesson).mockResolvedValue(mkLesson({ id: "L9", state: "FAILED", slots: mkSlots(3, [0, 1, 2]) }));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "command", topic: "", command: "retry" }), mkCtx(), "u1", "c1", io);
    expect(outcomes(writes)).toEqual([{ t: "outcome", outcome: "FAILED", failedIndices: [1, 2, 3], plannedCount: 3, readyCount: 0 }]);
  });
});

describe("run — failure handling (catch + flushT1)", () => {
  it("a mid-teach error (signal NOT aborted) → error evidence, log.run_failed, 'snag' message", async () => {
    vi.mocked(createLesson).mockRejectedValue(new Error("db exploded"));
    const { io, writes } = mkIO();
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);

    expect(t1(EVENTS.error)).toEqual([{ message: "db exploded" }]);
    expect(t1(EVENTS.lessonCancelled)).toHaveLength(0);
    expect(vi.mocked(log)).toHaveBeenCalledWith("error", "lesson.run_failed", expect.objectContaining({ userId: "u1", canvasId: "c1" }), expect.any(Error));
    expect(writes.at(-3)).toEqual({ t: "status", status: "error" });
    expect(writes.at(-2)).toEqual({ t: "error", recoverable: true, message: "The teacher hit a snag." });
    expect(writes.at(-1)).toEqual({ t: "done" });
  });

  it("an aborted signal turns the error into a lesson.cancelled event", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.mocked(createLesson).mockRejectedValue(new Error("interrupted"));
    const { io } = mkIO(ac.signal);
    await run(mkReq({ topic: "Photosynthesis" }), mkCtx(), "u1", "c1", io);

    expect(t1(EVENTS.lessonCancelled)).toEqual([{ reason: "aborted mid-teach" }]);
    expect(t1(EVENTS.error)).toHaveLength(0);
  });

  it("a dead Tier-1 outbox (emitMany throws on the final flush) is swallowed → still writes 'done'", async () => {
    vi.mocked(classifyIntent).mockResolvedValue(advise<IntentAdvice>({ intent: "greeting" }));
    vi.mocked(emitMany).mockRejectedValue(new Error("outbox dead"));
    const { io, writes } = mkIO();
    await run(mkReq({ kind: "question", topic: "", text: "hi" }), mkCtx(), "u1", "c1", io);

    // The greet content streamed, then the throwing flush routes into the catch → error + done.
    expect(regions(writes)).toContain("Agabi");
    expect(writes.at(-1)).toEqual({ t: "done" });
    expect(writes.at(-2)).toEqual({ t: "error", recoverable: true, message: "The teacher hit a snag." });
    expect(vi.mocked(log)).toHaveBeenCalledWith("error", "lesson.run_failed", expect.any(Object), expect.any(Error));
  });
});
