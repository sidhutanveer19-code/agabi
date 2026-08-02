import { prisma } from "@/server/db";
import type { LessonState } from "@/server/conversation/lessonState";
import { SLOT_STATES, type OutlineSlot, type SlotState } from "@/server/conversation/outline";

/**
 * The ONLY writers of lesson/session state. Every function takes plain values
 * (`string`, `number`, `OutlineSlot[]`) — NEVER `Advice<T>` — so raw model output
 * cannot reach persistence: it fails to compile. Deterministic code decides; these
 * execute the decision.
 */
export interface LessonRow {
  id: string;
  userId: string;
  canvasId: string;
  regionId: string;
  topic: string;
  slots: OutlineSlot[];
  cursor: number;
  state: LessonState;
}

/**
 * FIX 3 — backward-compatible slot read. Pre-Stage-B rows have no per-slot `state`;
 * they were taught + rendered, so the only honest reading is READY. Defaulting to
 * FAILED would invent degradation that never happened and poison every historical
 * Quality Score. Exported for a direct unit test.
 */
export function normalizeSlot(s: Omit<OutlineSlot, "state"> & { state?: string }): OutlineSlot & { state: SlotState } {
  const ok = (SLOT_STATES as readonly string[]).includes(s.state ?? "");
  return { ...s, state: ok ? (s.state as SlotState) : "READY" };
}

function toRow(l: { id: string; userId: string; canvasId: string; regionId: string; topic: string; slots: unknown; cursor: number; state: string }): LessonRow {
  const raw = (l.slots as (OutlineSlot & { state?: string })[]) ?? [];
  return { ...l, slots: raw.map(normalizeSlot), state: l.state as LessonState };
}

export async function getSession(userId: string, canvasId: string): Promise<{ id: string; activeLessonId: string | null }> {
  const s = await prisma.session.upsert({
    where: { userId_canvasId: { userId, canvasId } },
    update: {},
    create: { userId, canvasId },
    select: { id: true, activeLessonId: true },
  });
  return s;
}

export async function getLessons(userId: string, canvasId: string): Promise<LessonRow[]> {
  const rows = await prisma.lesson.findMany({ where: { userId, canvasId }, orderBy: { createdAt: "asc" } });
  return rows.map(toRow);
}

export async function getLesson(id: string): Promise<LessonRow | null> {
  const l = await prisma.lesson.findUnique({ where: { id } });
  return l ? toRow(l) : null;
}

export async function getActiveLesson(userId: string, canvasId: string): Promise<LessonRow | null> {
  const s = await getSession(userId, canvasId);
  if (!s.activeLessonId) return null;
  return getLesson(s.activeLessonId);
}

export async function createLesson(userId: string, canvasId: string, topic: string, regionId: string, slots: OutlineSlot[]): Promise<LessonRow> {
  const l = await prisma.lesson.create({
    data: { userId, canvasId, topic, regionId, slots: slots as unknown as object, cursor: 0, state: "IDLE" },
  });
  return toRow(l);
}

export async function setActiveLesson(userId: string, canvasId: string, lessonId: string | null): Promise<void> {
  await prisma.session.upsert({
    where: { userId_canvasId: { userId, canvasId } },
    update: { activeLessonId: lessonId },
    create: { userId, canvasId, activeLessonId: lessonId },
  });
}

export async function advanceCursor(lessonId: string, by: number): Promise<LessonRow> {
  const l = await prisma.lesson.update({ where: { id: lessonId }, data: { cursor: { increment: by } } });
  return toRow(l);
}

/**
 * COMPARE-AND-SET. Applies `to` only while the row still reads `from`, and reports whether it did.
 *
 * An unconditional update let two overlapping requests each read a state, both decide a transition
 * from it, and both write — last writer wins, with no trace that a decision was made against a state
 * that no longer existed. The lesson row has no lock and one teaching turn writes it three times
 * (slot states, cursor, state), so this is reachable with a double-tap or a second tab.
 *
 * `false` means someone else moved the lesson first; the caller must not treat its transition as
 * having happened.
 */
export async function setLessonState(lessonId: string, from: LessonState, to: LessonState): Promise<boolean> {
  const { count } = await prisma.lesson.updateMany({ where: { id: lessonId, state: from }, data: { state: to } });
  return count > 0;
}

/** Write per-slot states back into Lesson.slots (by array position) — the derived
 *  cache for quality + retry, rebuildable from slot.filled/slot.failed events. */
export async function setSlotStates(lessonId: string, updates: { index: number; state: SlotState }[]): Promise<void> {
  if (updates.length === 0) return;
  const l = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { slots: true } });
  if (!l) return;
  const slots = ((l.slots as unknown as (OutlineSlot & { state?: string })[]) ?? []).map(normalizeSlot);
  const byIndex = new Map(updates.map((u) => [u.index, u.state]));
  const next = slots.map((s, i) => (byIndex.has(i) ? { ...s, state: byIndex.get(i)! } : s));
  await prisma.lesson.update({ where: { id: lessonId }, data: { slots: next as unknown as object } });
}
