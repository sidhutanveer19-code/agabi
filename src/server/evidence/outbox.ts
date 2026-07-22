import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { log } from "@/server/log";

/**
 * Drain queued evidence (writes that failed transiently) into the real Event table.
 * Fire-and-forget at the top of the teach route + a cron-callable route. Never deletes
 * an Outbox row until the real insert succeeds; exponential backoff via nextRetryAt.
 */
export async function drainOutbox(limit = 50): Promise<{ drained: number; remaining: number }> {
  const now = new Date();
  let rows: Awaited<ReturnType<typeof prisma.outbox.findMany>>;
  try {
    rows = await prisma.outbox.findMany({
      where: { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
      orderBy: { firstFailure: "asc" },
      take: limit,
    });
  } catch (e) {
    log("error", "outbox.drain_query_failed", {}, e);
    return { drained: 0, remaining: -1 };
  }

  let drained = 0;
  for (const r of rows) {
    try {
      await prisma.event.create({
        data: {
          id: r.id, userId: r.userId, type: r.type, payload: r.payload as Prisma.InputJsonValue, source: "server",
          tier: r.tier, conversationId: r.conversationId, lessonId: r.lessonId, reqId: r.reqId,
          eventVersion: r.eventVersion, schemaVersion: r.schemaVersion,
          provenance: r.provenance == null ? undefined : (r.provenance as Prisma.InputJsonValue),
          causedByEventId: r.causedByEventId,
        },
      });
      await prisma.outbox.delete({ where: { id: r.id } }); // only after the real insert
      drained++;
    } catch (e) {
      const delaySec = Math.min(2 ** r.retryCount, 3600);
      await prisma.outbox
        .update({ where: { id: r.id }, data: { retryCount: { increment: 1 }, lastFailure: now, nextRetryAt: new Date(now.getTime() + delaySec * 1000) } })
        .catch(() => {});
      log("warn", "outbox.reinsert_failed", { type: r.type, tier: r.tier, retryCount: r.retryCount }, e);
    }
  }

  const remaining = await prisma.outbox.count().catch(() => -1);
  return { drained, remaining };
}

/** Backlog stats for the event-pipeline health provider (Stage C). */
export async function outboxStats(): Promise<{ backlog: number; oldestUnsyncedMs: number | null }> {
  const [backlog, oldest] = await Promise.all([
    prisma.outbox.count(),
    prisma.outbox.findFirst({ orderBy: { firstFailure: "asc" }, select: { firstFailure: true } }),
  ]);
  return { backlog, oldestUnsyncedMs: oldest ? Date.now() - oldest.firstFailure.getTime() : null };
}
