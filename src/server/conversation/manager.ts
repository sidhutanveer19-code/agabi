import crypto from "node:crypto";
import type { TeachRequest, TeachContext } from "@contract/schemas";
import { accept } from "@/server/advisors/advice";
import { classifyIntent, IntentAdviceSchema } from "@/server/advisors/intent";
import { providerChain, type ProviderEntry } from "@/server/advisors/providers";
import { fillChunk, RawSlotArraySchema, type ChunkSlot, type ChunkPrompts } from "@/server/advisors/chunk";
import type { ChunkSink } from "@/server/advisors/sink";
import { resolveAction, type ConversationAction, type LessonRef } from "@/server/conversation/actions";
import { transition } from "@/server/conversation/lessonState";
import { buildSkeleton } from "@/server/conversation/skeleton";
import { coerceSlot } from "@/server/conversation/coerce";
import { adaptBlock } from "@/server/conversation/validateBlock";
import { defaultOutline, repairOutline, isText, type OutlineSlot } from "@/server/conversation/outline";
import { batchSystemPrompt, batchPrompt, jsonSlotSystem, jsonSlotUser, textStreamSystem, textStreamUser } from "@/server/conversation/prompt";
import { getSession, getLessons, getLesson, createLesson, setActiveLesson, advanceCursor, setLessonState, type LessonRow } from "@/server/conversation/lessonRepo";
import { emit, EVENTS } from "@/server/events";

/** Blocks per teaching turn — the pacing constant. Change here and nowhere else. */
export const CHUNK = 3;

export interface TeachIO {
  write: (ev: object) => void;
  signal: AbortSignal;
}

interface RunCtx {
  userId: string;
  canvasId: string;
  sessionId: string;
  chain: ProviderEntry[];
  write: (ev: object) => void;
  signal: AbortSignal;
}

/** The one entry point. Deterministic routing owns every decision; the two advisor
 *  calls (classifyIntent, fillChunk) only propose. */
export async function run(request: TeachRequest, _context: TeachContext, userId: string, io: TeachIO): Promise<void> {
  const canvasId = userId; // one canvas per user until the frontend sends a real canvasId
  const ctx: RunCtx = { userId, canvasId, sessionId: crypto.randomUUID(), chain: providerChain(), write: io.write, signal: io.signal };

  await emit(userId, EVENTS.lessonStarted, { kind: request.kind, topic: request.topic }, "server", ctx.sessionId);
  ctx.write({ t: "status", status: "thinking" });

  if (ctx.chain.length === 0) {
    ctx.write({ t: "status", status: "error" });
    ctx.write({ t: "error", recoverable: true, message: "No model configured. Add a free key (GROQ_API_KEY) or run Ollama." });
    ctx.write({ t: "done" });
    return;
  }

  const [session, lessons] = await Promise.all([getSession(userId, canvasId), getLessons(userId, canvasId)]);
  const active = session.activeLessonId ? lessons.find((l) => l.id === session.activeLessonId) ?? null : null;
  const refs: LessonRef[] = lessons.map((l) => ({ id: l.id, topic: l.topic, regionId: l.regionId }));
  const activeRef: LessonRef | null = active ? { id: active.id, topic: active.topic, regionId: active.regionId } : null;

  const action = await decideAction(ctx, request, activeRef, refs);
  // Observation seam: every action is a typed, logged event.
  await emit(userId, EVENTS.commandSent, { action: action.kind }, "server", ctx.sessionId);

  switch (action.kind) {
    case "Greet": sayOnce(ctx, "Agabi", "Hi — I'm Agabi. What would you like to learn?"); break;
    case "AskForTopic": sayOnce(ctx, "Agabi", "What topic should we start with?"); break;
    case "StartLesson": await startLesson(ctx, action.topic); break;
    case "ContinueLesson": await continueLesson(ctx, action.lessonId); break;
    case "Simplify": await simplify(ctx, action.lessonId); break;
    case "SwitchLesson": await setActiveLesson(userId, canvasId, action.lessonId); await continueLesson(ctx, action.lessonId); break;
    case "Answer": await answer(ctx, action.text, action.topic); break;
  }
  ctx.write({ t: "done" });
}

// ── Routing — a MODEL call only to classify; the decision is deterministic ──
async function decideAction(ctx: RunCtx, request: TeachRequest, activeRef: LessonRef | null, refs: LessonRef[]): Promise<ConversationAction> {
  if (request.kind === "command") {
    const c = request.command;
    if (c === "continue") return activeRef ? { kind: "ContinueLesson", lessonId: activeRef.id } : { kind: "AskForTopic" };
    if (c === "simpler") return activeRef ? { kind: "Simplify", lessonId: activeRef.id } : { kind: "AskForTopic" };
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

// ── Lesson lifecycle — deterministic; cursor advances by CHUNK regardless of the model ──
async function startLesson(ctx: RunCtx, topicRaw: string): Promise<void> {
  const topic = topicRaw.trim() || "this idea";
  ctx.write({ t: "status", status: "planning" });
  const { outline } = repairOutline(defaultOutline(topic), topic);
  const lesson = await createLesson(ctx.userId, ctx.canvasId, topic, crypto.randomUUID(), outline);
  await setLessonState(lesson.id, transition("IDLE", "start")); // PLANNING
  await setLessonState(lesson.id, transition("PLANNING", "planned")); // TEACHING
  await teachChunk(ctx, { ...lesson, state: "TEACHING" }, 0, "start");
  const advanced = Math.min(CHUNK, outline.length);
  await advanceCursor(lesson.id, advanced);
  await setLessonState(lesson.id, advanced >= outline.length ? transition("TEACHING", "complete") : transition("TEACHING", "chunkEmitted"));
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
  await setLessonState(lesson.id, transition("WAITING_FOR_STUDENT", "continue")); // TEACHING
  await teachChunk(ctx, { ...lesson, state: "TEACHING" }, lesson.cursor, "continue");
  const advanced = Math.min(CHUNK, lesson.slots.length - lesson.cursor);
  await advanceCursor(lesson.id, advanced);
  const newCursor = lesson.cursor + advanced;
  await setLessonState(lesson.id, newCursor >= lesson.slots.length ? transition("TEACHING", "complete") : transition("TEACHING", "chunkEmitted"));
}

async function simplify(ctx: RunCtx, lessonId: string): Promise<void> {
  const lesson = await getLesson(lessonId);
  if (!lesson) return sayOnce(ctx, "Agabi", "There's no lesson to simplify — pick a topic to start.");
  const start = Math.max(0, lesson.cursor - CHUNK); // re-teach the LAST chunk
  await setLessonState(lesson.id, transition("WAITING_FOR_STUDENT", "simplify")); // SIMPLIFYING
  await teachChunk(ctx, lesson, start, "simplify"); // cursor UNCHANGED
  await setLessonState(lesson.id, transition("SIMPLIFYING", "simplified")); // WAITING_FOR_STUDENT
}

async function answer(ctx: RunCtx, text: string, topic: string | null): Promise<void> {
  ctx.write({ t: "region", title: topic ?? "Question" }); // topic title → flows beneath that lesson
  ctx.write({ t: "status", status: "generating" });
  const slot: OutlineSlot = { slot: 0, type: "paragraph", intent: text };
  const sk = buildSkeleton([slot], topic ?? text);
  const a0 = adaptBlock(sk[0].type, sk[0].data, sk[0].streamText);
  ctx.write({ t: "block", block: { type: a0.type, data: a0.data, streamText: a0.streamText } });
  const prompts: ChunkPrompts = {
    batchSystem: batchSystemPrompt(),
    batchUser: batchPrompt(topic ?? text, [{ slot: 0, type: "paragraph", intent: text }]),
    perSlot: { 0: { jsonSystem: jsonSlotSystem(), jsonUser: jsonSlotUser(topic ?? text, slot), textSystem: textStreamSystem(), textUser: `Answer this for a 14-16 year old in 2-3 clear sentences: ${text}` } },
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

// ── Teach one chunk: skeleton (instant) → advisor fills → coerce + patch + telemetry ──
async function teachChunk(ctx: RunCtx, lesson: LessonRow, startIndex: number, mode: "start" | "continue" | "simplify"): Promise<void> {
  const topic = lesson.topic;
  const chunkSlots = lesson.slots.slice(startIndex, startIndex + CHUNK);
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

  // Authoritative pass: coerce → final patch → telemetry. Cursor is NOT touched here.
  let filled = 0;
  const rungCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let served: string | null = null;
  for (const r of raws) {
    const s = eff[r.index]; if (!s) continue;
    const c = coerceSlot(s.type, r.data ?? (r.text != null ? { text: r.text } : {}), r.text ?? "", s.intent);
    if (c.status === "minimal") continue; // stays skeleton (unresolved)
    const rung = c.status === "repaired" ? 4 : r.later ? 2 : r.retry ? 3 : 1;
    rungCount[rung]++; filled++;
    served = served ?? r.provider;
    const a = adaptBlock(c.type, c.data, isText(c.type) ? String(c.data.text ?? "") : undefined);
    ctx.write({ t: "patch", index: r.index, data: a.data });
    void emit(ctx.userId, EVENTS.slotFilled, { slot: startIndex + r.index, provider: r.provider, model: r.model, slotType: s.type, rung, ok: true, ms: r.ms, tokens: r.tokens }, "server", ctx.sessionId);
  }
  const authorRate = chunkSlots.length ? filled / chunkSlots.length : 0;
  ctx.write({ t: "usage", provider: served, slots: chunkSlots.length, authorRate, rungCount, unresolved: chunkSlots.length - filled });
  ctx.write({ t: "status", status: "finished" });
}
