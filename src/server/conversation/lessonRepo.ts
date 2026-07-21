import { prisma } from "@/server/db";
import type { LessonState } from "@/server/conversation/lessonState";
import type { OutlineSlot } from "@/server/conversation/outline";

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

function toRow(l: { id: string; userId: string; canvasId: string; regionId: string; topic: string; slots: unknown; cursor: number; state: string }): LessonRow {
  return { ...l, slots: (l.slots as OutlineSlot[]) ?? [], state: l.state as LessonState };
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

export async function setLessonState(lessonId: string, state: LessonState): Promise<void> {
  await prisma.lesson.update({ where: { id: lessonId }, data: { state } });
}
