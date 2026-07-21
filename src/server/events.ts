import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

/**
 * The ONLY write path for events [I4]. Append-only: emit + purgeUser (erasure), no
 * update/delete otherwise. Best-effort — a missing/unhealthy DB never breaks a
 * lesson (capture is important but never at the cost of the journey).
 */
export type EventSource = "server" | "client";

/** D4 taxonomy — the fixed set we capture. No pan/zoom/continuous gestures. */
export const EVENTS = {
  lessonStarted: "lesson.started",
  lessonFinished: "lesson.finished",
  lessonCancelled: "lesson.cancelled",
  outlineRepaired: "outline.repaired",
  outlineFallback: "outline.fallback",
  slotFilled: "slot.filled",
  fillBudgetExhausted: "fill.budget.exhausted",
  headOfLineForced: "fill.hol.forced",
  slotBackfilled: "slot.backfilled",
  slotCoerced: "slot.coerced",
  blockEmitted: "block.emitted",
  blockFallback: "block.fallback",
  providerUsed: "provider.used",
  providerRatelimited: "provider.ratelimited",
  commandSent: "command.sent",
  workspaceSaved: "workspace.saved",
  error: "error",
} as const;

/** Client events we accept (the rest are server-emitted and unspoofable). */
export const CLIENT_EVENT_ALLOWLIST = new Set<string>([
  EVENTS.commandSent,
  "topic_opened",
  "lesson_started",
  "lesson_completed",
  "question_asked",
]);

interface EmitInput {
  userId: string;
  type: string;
  payload: unknown;
  source: EventSource;
  sessionId?: string;
}

function toJson(payload: unknown): Prisma.InputJsonValue {
  return (payload ?? {}) as Prisma.InputJsonValue;
}

export async function emit(
  userId: string,
  type: string,
  payload: unknown,
  source: EventSource,
  sessionId?: string,
): Promise<void> {
  try {
    await prisma.event.create({
      data: { userId, type, payload: toJson(payload), source, sessionId },
    });
  } catch {
    /* best-effort: never break the caller */
  }
}

export async function emitMany(rows: EmitInput[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await prisma.event.createMany({
      data: rows.map((r) => ({
        userId: r.userId,
        type: r.type,
        payload: toJson(r.payload),
        source: r.source,
        sessionId: r.sessionId,
      })),
    });
  } catch {
    /* best-effort */
  }
}

/** The one exception to append-only — full erasure for a single user [I4]. */
export async function purgeUser(userId: string): Promise<number> {
  const res = await prisma.event.deleteMany({ where: { userId } });
  return res.count;
}
