import crypto from "node:crypto";
import type { TeachRequest, TeachContext } from "@contract/schemas";
import { accept } from "@/server/advisors/advice";
import { classifyIntent, IntentAdviceSchema } from "@/server/advisors/intent";
import { providerChain, type ProviderEntry } from "@/server/advisors/providers";
import { fillChunk, RawSlotArraySchema, type ChunkSlot, type ChunkPrompts } from "@/server/advisors/chunk";
import type { ChunkSink } from "@/server/advisors/sink";
import { resolveAction, type ConversationAction, type LessonRef } from "@/server/conversation/actions";
import { smallTalkReply } from "@/server/conversation/smalltalk";
import { transition, type LessonState, type LessonEvent } from "@/server/conversation/lessonState";
import { buildSkeleton } from "@/server/conversation/skeleton";
import { coerceSlot } from "@/server/conversation/coerce";
import { adaptBlock } from "@/server/conversation/validateBlock";
import { repairOutline, isText, classifySubject, type OutlineSlot, type SlotState } from "@/server/conversation/outline";
import { batchSystemPrompt, batchPrompt, jsonSlotSystem, jsonSlotUser, textStreamSystem, textStreamUser } from "@/server/conversation/prompt";
import { getSession, getLessons, getLesson, createLesson, setActiveLesson, advanceCursor, setLessonState, setSlotStates, type LessonRow } from "@/server/conversation/lessonRepo";
import { buildCanvasContext } from "@/server/conversation/context";
import { setCanvasMeta } from "@/server/conversation/canvasRepo";
import { scoreLesson } from "@/server/conversation/quality";
import { PROMPT_VERSION } from "@/server/conversation/prompt";
import { KNOWLEDGE_GROUNDING_ON, SOURCE_GROUNDING_ON } from "@/env";
import { chooseOutline, groundedOutline, sourceGroundedOutline, defaultKnowledgeStore, type GroundedOutline } from "@/server/conversation/grounding";
import { emit, emitMany, EVENTS, type EmitMeta, type EmitInput } from "@/server/events";
import { log } from "@/server/log";

/** Blocks per teaching turn — the pacing constant. Change here and nowhere else. */
export const CHUNK = 3;

export interface TeachIO {
  write: (ev: object) => void;
  signal: AbortSignal;
  reqId: string; // one HTTP request — minted in the teach route, on every log line + event
}

interface RunCtx {
  userId: string;
  canvasId: string;
  conversationId: string; // stable per (userId, canvasId) — the Session row id (NOT a per-request uuid)
  reqId: string;
  provenance: Record<string, unknown>;
  lessonId: string | null; // set once the lesson is known; correlates all lesson-scoped evidence
  t1: EmitInput[]; // Tier-1 buffer, flushed once per chunk (FIX 6) — a batch, not a round-trip per event
  chain: ProviderEntry[];
  write: (ev: object) => void;
  signal: AbortSignal;
}

// ── Evidence helpers (the flight recorder). T2/T3 fire-and-forget; T1 buffered + flushed. ──
function meta(ctx: RunCtx, extra?: Partial<EmitMeta>): EmitMeta {
  return { conversationId: ctx.conversationId, reqId: ctx.reqId, lessonId: ctx.lessonId, provenance: ctx.provenance, ...extra };
}
/** Tier-2/3 evidence — never blocks teaching. */
function ev(ctx: RunCtx, type: string, payload: unknown, extra?: Partial<EmitMeta>): void {
  void emit(ctx.userId, type, payload, "server", meta(ctx, extra));
}
/** Tier-1 evidence — buffered; `flushT1` writes the batch (may THROW if unrecordable → lesson stops). */
function t1(ctx: RunCtx, type: string, payload: unknown, extra?: Partial<EmitMeta>): void {
  ctx.t1.push({ userId: ctx.userId, type, payload, source: "server", ...meta(ctx, { tier: 1, ...extra }) });
}
async function flushT1(ctx: RunCtx): Promise<void> {
  if (ctx.t1.length === 0) return;
  const batch = ctx.t1;
  ctx.t1 = [];
  await emitMany(batch); // throws only for transient Tier-1 with a dead Outbox
}

/** The one entry point. Deterministic routing owns every decision; the two advisor
 *  calls (classifyIntent, fillChunk) only propose. */
export async function run(request: TeachRequest, _context: TeachContext, userId: string, canvasId: string, io: TeachIO): Promise<void> {
  // canvasId is a REQUIRED path segment (POST /api/canvas/{canvasId}/teach) — no
  // `?? userId` fallback, so state can never silently bleed across canvases.
  // session FIRST — its stable id is the conversationId (the flight-recorder correlation key).
  const [session, lessons] = await Promise.all([getSession(userId, canvasId), getLessons(userId, canvasId)]);
  const ctx: RunCtx = {
    userId, canvasId, conversationId: session.id, reqId: io.reqId,
    provenance: { promptVersion: PROMPT_VERSION, pipelineVersion: "conversation-v1" },
    lessonId: null, t1: [], chain: providerChain(), write: io.write, signal: io.signal,
  };

  const reqText = (request.kind === "question" ? request.text : request.topic) ?? "";
  t1(ctx, EVENTS.requestReceived, { kind: request.kind, text: reqText, command: request.command });
  ctx.write({ t: "status", status: "thinking" });

  if (ctx.chain.length === 0) {
    t1(ctx, EVENTS.error, { message: "no model configured" });
    await flushT1(ctx).catch(() => {});
    ctx.write({ t: "status", status: "error" });
    ctx.write({ t: "error", recoverable: true, message: "No model configured. Add a free key (GROQ_API_KEY) or run Ollama." });
    ctx.write({ t: "done" });
    return;
  }

  const active = session.activeLessonId ? lessons.find((l) => l.id === session.activeLessonId) ?? null : null;
  const refs: LessonRef[] = lessons.map((l) => ({ id: l.id, topic: l.topic, regionId: l.regionId }));
  const activeRef: LessonRef | null = active ? { id: active.id, topic: active.topic, regionId: active.regionId } : null;

  try {
    const action = await decideAction(ctx, request, activeRef, refs);
    t1(ctx, EVENTS.commandSent, { action: action.kind }); // the routing decision

    switch (action.kind) {
      case "Greet": sayOnce(ctx, "Agabi", smallTalkReply(reqText)); break;
      case "AskForTopic": sayOnce(ctx, "Agabi", "What topic should we start with?"); break;
      case "StartLesson":
        // First lesson on this canvas → stamp its title + subject once (canvas identity).
        if (lessons.length === 0) await setCanvasMeta(userId, canvasId, { title: action.topic, subject: classifySubject(action.topic) });
        await startLesson(ctx, action.topic, reqText);
        break;
      case "ContinueLesson": await continueLesson(ctx, action.lessonId); break;
      case "Simplify": await simplify(ctx, action.lessonId); break;
      case "RetryLesson": await retryLesson(ctx, action.lessonId); break;
      case "SwitchLesson": await setActiveLesson(userId, canvasId, action.lessonId); await continueLesson(ctx, action.lessonId); break;
      case "Answer": await answer(ctx, action.text, action.topic); break;
    }
    await flushT1(ctx);
  } catch (e) {
    if (ctx.signal.aborted) t1(ctx, EVENTS.lessonCancelled, { reason: "aborted mid-teach" });
    else t1(ctx, EVENTS.error, { message: e instanceof Error ? e.message : "unknown" });
    await flushT1(ctx).catch(() => {}); // a genuinely-unrecordable failure already threw; don't mask it further
    log("error", "lesson.run_failed", { userId, conversationId: ctx.conversationId, lessonId: ctx.lessonId, reqId: ctx.reqId, canvasId }, e);
    ctx.write({ t: "status", status: "error" });
    ctx.write({ t: "error", recoverable: true, message: "The teacher hit a snag." });
  }
  ctx.write({ t: "done" });
}

// ── Routing — a MODEL call only to classify; the decision is deterministic ──
async function decideAction(ctx: RunCtx, request: TeachRequest, activeRef: LessonRef | null, refs: LessonRef[]): Promise<ConversationAction> {
  if (request.kind === "command") {
    const c = request.command;
    if (c === "continue") return activeRef ? { kind: "ContinueLesson", lessonId: activeRef.id } : { kind: "AskForTopic" };
    if (c === "simpler") return activeRef ? { kind: "Simplify", lessonId: activeRef.id } : { kind: "AskForTopic" };
    if (c === "retry") return activeRef ? { kind: "RetryLesson", lessonId: activeRef.id } : { kind: "AskForTopic" };
    return { kind: "Answer", text: commandText(c), topic: activeRef?.topic ?? null };
  }
  const text = (request.kind === "question" ? request.text : request.topic) ?? "";
  const advice = await classifyIntent(text); // advisor (untrusted)
  const parsed = accept(advice, IntentAdviceSchema); // validated, or null → unclear
  return resolveAction(parsed?.intent ?? "unclear", text, parsed?.target, activeRef, refs);
}

const COMMANDS: Record<string, string> = {
  harder: "Explain this in more depth for an advanced student.",
  example: "Give another concrete worked example of this.",
  visual: "Explain this again primarily with a diagram.",
  again: "Explain this again from a fresh angle.",
  why: "Explain why this is true.",
  how: "Explain how this works, step by step.",
  whatif: "Explore what changes if we vary this.",
};
const commandText = (c?: string) => (c && COMMANDS[c]) || "Tell me more about this.";

// ── Deterministic replies (no model, no lesson) — this is where "hi" dies ──
function sayOnce(ctx: RunCtx, title: string, text: string): void {
  ctx.write({ t: "region", title });
  ctx.write({ t: "status", status: "generating" });
  const a = adaptBlock("paragraph", { text }, text);
  ctx.write({ t: "block", block: { type: a.type, data: a.data, streamText: a.streamText } });
  ctx.write({ t: "status", status: "finished" });
}

// ── Evidence-emitting wrappers around the deterministic state writers ──
async function transitTo(ctx: RunCtx, lessonId: string, from: LessonState, event: LessonEvent): Promise<LessonState> {
  const to = transition(from, event); // throws on illegal — that's the guard
  await setLessonState(lessonId, to);
  t1(ctx, EVENTS.lessonState, { from, to });
  return to;
}
async function advance(ctx: RunCtx, lessonId: string, by: number, newCursor: number): Promise<void> {
  await advanceCursor(lessonId, by);
  t1(ctx, EVENTS.lessonCursor, { cursor: newCursor, advanced: by }); // READY-only progress
}
/** Emit the Tier-1 Lesson Health Report + the on-wire outcome the frontend renders.
 *  Score is DERIVED on read from the lesson's persisted slot states (invariant 2) —
 *  which are themselves rebuildable from slot.filled/slot.failed events (invariant 8). */
async function finishLesson(ctx: RunCtx, lessonId: string): Promise<void> {
  const lesson = await getLesson(lessonId);
  const q = scoreLesson(lesson?.slots ?? []);
  const event: LessonEvent = q.outcome === "COMPLETE" ? "complete" : q.outcome === "PARTIAL" ? "partial" : "fail";
  await transitTo(ctx, lessonId, "TEACHING", event); // → COMPLETED | PARTIAL | FAILED
  t1(ctx, EVENTS.lessonFinished, { outcome: q.outcome, plannedCount: q.plannedCount, readyCount: q.readyCount, failedIndices: q.failedIndices, why: q.why });
  ctx.write({ t: "outcome", outcome: q.outcome, failedIndices: q.failedIndices, plannedCount: q.plannedCount, readyCount: q.readyCount });
}

// ── Lesson lifecycle — deterministic; cursor advances by CHUNK regardless of the model ──
async function startLesson(ctx: RunCtx, topicRaw: string, reqText: string): Promise<void> {
  const topic = topicRaw.trim() || "this idea";
  ctx.write({ t: "status", status: "planning" });
  // ── M5 teaching bridge (§8.2) — the ONE call site. Flag OFF (default) ⇒ `grounded` stays
  // null ⇒ chooseOutline returns defaultOutline(topic), byte-identical to Phase 1. Grounding
  // never kills a lesson: any failure (incl. no DB) falls back to the default. ──
  let grounded: GroundedOutline | null = null;
  if (KNOWLEDGE_GROUNDING_ON()) {
    try {
      grounded = await groundedOutline(defaultKnowledgeStore(), topic); // graph = higher trust, first
    } catch {
      grounded = null; // fall back — a grounding error is never student-facing
    }
    if (grounded && grounded.assetCount === 0) ev(ctx, EVENTS.teachingMiss, { topic }); // grounded, no asset (§13.1)
  }
  // A-7: when the graph doesn't cover the topic, teach from retrieved textbook text instead of
  // free-generating. Lower trust than the graph, so it runs ONLY after a graph miss.
  if (!grounded && SOURCE_GROUNDING_ON()) {
    try {
      grounded = await sourceGroundedOutline(defaultKnowledgeStore(), topic);
    } catch {
      grounded = null;
    }
  }
  if (KNOWLEDGE_GROUNDING_ON() && !grounded) ev(ctx, EVENTS.knowledgeMiss, { topic }); // nothing covered it
  const { outline, changes } = repairOutline(chooseOutline(topic, grounded), topic);
  const lesson = await createLesson(ctx.userId, ctx.canvasId, topic, crypto.randomUUID(), outline);
  ctx.lessonId = lesson.id; // from here, all evidence correlates to this lesson
  // routing + requestText ride on lesson.started too — command.sent/request.received fire
  // before the lessonId exists (lessonId=null), so this keeps a lessonId-only replay complete.
  // §28: stamp grounded/conceptIds/promptVersion so a lesson's grounding is evidence, not a guess.
  t1(ctx, EVENTS.lessonStarted, {
    topic, requestText: reqText, routing: "StartLesson", slots: outline.length,
    grounded: !!grounded, conceptIds: grounded?.conceptIds ?? [],
    promptVersion: grounded?.promptVersion ?? PROMPT_VERSION,
  });
  ev(ctx, EVENTS.outlinePlanned, { slots: outline.map((s) => ({ slot: s.slot, type: s.type })) });
  if (changes.length) ev(ctx, EVENTS.outlineRepaired, { changes });
  await transitTo(ctx, lesson.id, "IDLE", "start"); // PLANNING
  await transitTo(ctx, lesson.id, "PLANNING", "planned"); // TEACHING
  await teachChunk(ctx, { ...lesson, state: "TEACHING" }, 0, "start");
  const advanced = Math.min(CHUNK, outline.length);
  await advance(ctx, lesson.id, advanced, advanced);
  if (advanced >= outline.length) await finishLesson(ctx, lesson.id); // → COMPLETE/PARTIAL/FAILED
  else await transitTo(ctx, lesson.id, "TEACHING", "chunkEmitted");
  await setActiveLesson(ctx.userId, ctx.canvasId, lesson.id);
}

async function continueLesson(ctx: RunCtx, lessonId: string): Promise<void> {
  const lesson = await getLesson(lessonId);
  if (!lesson) return sayOnce(ctx, "Agabi", "That lesson isn't here anymore — pick a topic to start fresh.");
  await setActiveLesson(ctx.userId, ctx.canvasId, lesson.id);
  if (lesson.cursor >= lesson.slots.length) {
    sayOnce(ctx, lesson.topic, `That's the whole lesson on ${lesson.topic}. Ask a question, or start a new topic.`);
    return;
  }
  ctx.lessonId = lesson.id;
  await transitTo(ctx, lesson.id, "WAITING_FOR_STUDENT", "continue"); // TEACHING
  await teachChunk(ctx, { ...lesson, state: "TEACHING" }, lesson.cursor, "continue");
  const advanced = Math.min(CHUNK, lesson.slots.length - lesson.cursor);
  const newCursor = lesson.cursor + advanced;
  await advance(ctx, lesson.id, advanced, newCursor);
  if (newCursor >= lesson.slots.length) await finishLesson(ctx, lesson.id);
  else await transitTo(ctx, lesson.id, "TEACHING", "chunkEmitted");
}

async function simplify(ctx: RunCtx, lessonId: string): Promise<void> {
  const lesson = await getLesson(lessonId);
  if (!lesson) return sayOnce(ctx, "Agabi", "There's no lesson to simplify — pick a topic to start.");
  ctx.lessonId = lesson.id;
  const start = Math.max(0, lesson.cursor - CHUNK); // re-teach the LAST chunk
  await transitTo(ctx, lesson.id, "WAITING_FOR_STUDENT", "simplify"); // SIMPLIFYING
  await teachChunk(ctx, lesson, start, "simplify"); // cursor UNCHANGED
  await transitTo(ctx, lesson.id, "SIMPLIFYING", "simplified"); // WAITING_FOR_STUDENT
}

async function answer(ctx: RunCtx, text: string, topic: string | null): Promise<void> {
  ctx.write({ t: "region", title: topic ?? "Question" }); // topic title → flows beneath that lesson
  ctx.write({ t: "status", status: "generating" });
  // Memory seam: the answer sees what's on the canvas via buildCanvasContext, so
  // "what did you explain earlier?" references prior lessons instead of guessing.
  const canvas = await buildCanvasContext(ctx.userId, ctx.canvasId);
  const priorTopics = [canvas.currentLesson?.topic, ...canvas.previousLessons.map((l) => l.topic)].filter((t): t is string => !!t);
  const memory = priorTopics.length ? ` So far on this canvas the student has studied: ${priorTopics.join(", ")}. Refer to that where relevant.` : "";
  const slot: OutlineSlot = { slot: 0, type: "paragraph", intent: text };
  const sk = buildSkeleton([slot], topic ?? text);
  const a0 = adaptBlock(sk[0].type, sk[0].data, sk[0].streamText);
  ctx.write({ t: "block", block: { type: a0.type, data: a0.data, streamText: a0.streamText } });
  const prompts: ChunkPrompts = {
    batchSystem: batchSystemPrompt(),
    batchUser: batchPrompt(topic ?? text, [{ slot: 0, type: "paragraph", intent: text }]),
    perSlot: { 0: { jsonSystem: jsonSlotSystem(), jsonUser: jsonSlotUser(topic ?? text, slot), textSystem: textStreamSystem(), textUser: `Answer this for a 14-16 year old in 2-3 clear sentences.${memory} Question: ${text}` } },
  };
  const sink: ChunkSink = {
    onText: (_i, full) => { const a = adaptBlock("paragraph", { text: full }, full); ctx.write({ t: "patch", index: 0, data: a.data }); },
    onSlot: () => { /* answer is text-only */ },
  };
  const advice = await fillChunk([{ index: 0, type: "paragraph", isText: true }], ctx.chain, prompts, sink, ctx.signal);
  const r = (accept(advice, RawSlotArraySchema) ?? [])[0];
  if (r?.text) { const a = adaptBlock("paragraph", { text: r.text }, r.text); ctx.write({ t: "patch", index: 0, data: a.data }); }
  ctx.write({ t: "status", status: "finished" });
}

// ── Fill an ARBITRARY set of slots (contiguous chunk OR scattered failed indices):
//    skeleton (instant) → advisor fills → coerce + patch + evidence. `chunkSlots[i]`
//    corresponds to absolute slot position `absIndices[i]`. ──
async function fillSlots(ctx: RunCtx, lesson: LessonRow, chunkSlots: OutlineSlot[], absIndices: number[], mode: "start" | "continue" | "simplify"): Promise<void> {
  const topic = lesson.topic;
  if (chunkSlots.length === 0) return;

  ctx.write({ t: "region", title: topic }); // title = topic → title-grouping stacks chunks in-flow
  ctx.write({ t: "status", status: "generating" });

  // Skeleton — instant shape (ttfb). Deterministic; no model.
  const skeleton = buildSkeleton(chunkSlots, topic);
  const eff = chunkSlots.map((s, i) => ({ ...s, type: skeleton[i].type, slot: i })); // slot = chunk-local index
  for (const b of skeleton) {
    const a = adaptBlock(b.type, b.data, b.streamText);
    ctx.write({ t: "block", block: { type: a.type, data: a.data, streamText: a.streamText } });
  }

  // Prompts built HERE (conversation), passed to the advisor as strings.
  const simpler = mode === "simplify" ? " Explain it more simply than before — shorter, plainer words." : "";
  const promptOutline = eff.map((s) => ({ slot: s.slot, type: s.type, intent: s.intent }));
  const prompts: ChunkPrompts = {
    batchSystem: batchSystemPrompt() + simpler,
    batchUser: batchPrompt(topic, promptOutline),
    perSlot: Object.fromEntries(eff.map((s) => [s.slot, {
      jsonSystem: jsonSlotSystem(),
      jsonUser: jsonSlotUser(topic, s),
      textSystem: textStreamSystem() + simpler,
      textUser: textStreamUser(topic, s),
    }])),
  };
  const advisorSlots: ChunkSlot[] = eff.map((s) => ({ index: s.slot, type: s.type, isText: isText(s.type) }));

  // Interim UI patches as content streams in (advisor never writes; it calls the sink).
  const sink: ChunkSink = {
    onText: (i, full) => { const s = eff[i]; if (!s) return; const a = adaptBlock(s.type, { text: full }, full); ctx.write({ t: "patch", index: i, data: a.data }); },
    onSlot: (i, payload) => {
      const s = eff[i]; if (!s) return;
      const c = coerceSlot(s.type, (payload ?? {}) as Record<string, unknown>, "", s.intent);
      if (c.status !== "minimal") { const a = adaptBlock(c.type, c.data, isText(c.type) ? String(c.data.text ?? "") : undefined); ctx.write({ t: "patch", index: i, data: a.data }); }
    },
  };

  const advice = await fillChunk(advisorSlots, ctx.chain, prompts, sink, ctx.signal); // advisor (untrusted)
  const raws = accept(advice, RawSlotArraySchema) ?? []; // validated

  // Authoritative pass: coerce → final patch → RAW evidence. Cursor is NOT touched here.
  // Per-slot state is the source of truth for quality; NO ratio/score is persisted (invariant 2).
  const filledIdx = new Set<number>(); // chunk-local indices that reached READY
  let served: string | null = null;
  for (const r of raws) {
    const s = eff[r.index]; if (!s) continue;
    const c = coerceSlot(s.type, r.data ?? (r.text != null ? { text: r.text } : {}), r.text ?? "", s.intent);
    if (c.status === "minimal") continue; // silent-failure case → left FAILED below
    const rung = c.status === "repaired" ? 4 : r.later ? 2 : r.retry ? 3 : 1;
    served = served ?? r.provider;
    filledIdx.add(r.index);
    const a = adaptBlock(c.type, c.data, isText(c.type) ? String(c.data.text ?? "") : undefined);
    ctx.write({ t: "patch", index: r.index, data: a.data });
    ev(ctx, EVENTS.slotFilled, { slot: absIndices[r.index], provider: r.provider, model: r.model, slotType: s.type, rung, ok: true, ms: r.ms, tokens: r.tokens });
  }

  // Every slot in the chunk gets an explicit state — READY if filled, else FAILED
  // (minimal/never-returned). This is what makes a silent skeleton a first-class failure.
  const stateUpdates: { index: number; state: SlotState }[] = [];
  for (let i = 0; i < chunkSlots.length; i++) {
    const abs = absIndices[i];
    if (filledIdx.has(i)) stateUpdates.push({ index: abs, state: "READY" });
    else { stateUpdates.push({ index: abs, state: "FAILED" }); ev(ctx, EVENTS.slotFailed, { slot: abs, slotType: eff[i]?.type, reason: "minimal/unfilled" }); }
  }
  await setSlotStates(lesson.id, stateUpdates);
  if (served) ev(ctx, EVENTS.providerUsed, { provider: served, chunkStart: absIndices[0] });
  ctx.write({ t: "status", status: "finished" });
}

/** Teach one CONTIGUOUS chunk — the normal path (start/continue/simplify). Thin wrapper over fillSlots. */
async function teachChunk(ctx: RunCtx, lesson: LessonRow, startIndex: number, mode: "start" | "continue" | "simplify"): Promise<void> {
  const chunkSlots = lesson.slots.slice(startIndex, startIndex + CHUNK);
  const absIndices = chunkSlots.map((_, i) => startIndex + i);
  await fillSlots(ctx, lesson, chunkSlots, absIndices, mode);
}

/** Regenerate ONLY the FAILED blocks — never re-runs READY ones, leaves the cursor alone.
 *  Re-fills just the failed slots, re-scores from the updated slot states, emits a fresh outcome. */
async function retryLesson(ctx: RunCtx, lessonId: string): Promise<void> {
  const lesson = await getLesson(lessonId);
  if (!lesson) return sayOnce(ctx, "Agabi", "That lesson isn't here anymore — pick a topic to start fresh.");
  const failed = lesson.slots.map((s, i) => ({ s, i })).filter((x) => x.s.state === "FAILED");
  if (failed.length === 0) {
    sayOnce(ctx, lesson.topic, "Nothing to retry — every section came through.");
    return;
  }
  ctx.lessonId = lesson.id;
  await transitTo(ctx, lesson.id, lesson.state, "retry"); // PARTIAL|FAILED → TEACHING
  await fillSlots(ctx, lesson, failed.map((x) => x.s), failed.map((x) => x.i), "start"); // only the failed slots hit the model
  await finishLesson(ctx, lesson.id); // re-score from updated slot states → new COMPLETE/PARTIAL/FAILED + outcome
}
