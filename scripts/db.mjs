// Dev DB inspector for the V-suite. Run with: node --env-file=.env.local scripts/db.mjs <cmd> [arg]
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "check") {
    console.log(JSON.stringify({
      workspace: await prisma.workspace.count(),
      event: await prisma.event.count(),
      consent: await prisma.consent.count(),
    }));
  } else if (cmd === "events") {
    const rows = await prisma.event.findMany({ where: { userId: arg }, select: { type: true } });
    const by = {};
    for (const r of rows) by[r.type] = (by[r.type] ?? 0) + 1;
    console.log(JSON.stringify(by));
  } else if (cmd === "finished") {
    const rows = await prisma.event.findMany({ where: { userId: arg, type: "lesson.finished" }, select: { payload: true } });
    console.log(JSON.stringify(rows.map((r) => r.payload)));
  } else if (cmd === "purge") {
    const del = await prisma.event.deleteMany({ where: { userId: arg } });
    const remaining = await prisma.event.count({ where: { userId: arg } });
    console.log(JSON.stringify({ deleted: del.count, remaining }));
  } else if (cmd === "workspace") {
    const w = await prisma.workspace.findUnique({ where: { id: arg } });
    console.log(JSON.stringify({ exists: !!w, hasDoc: !!(w && w.doc), userId: w?.userId ?? null }));
  } else if (cmd === "resetall") {
    const del = await prisma.event.deleteMany({});
    console.log(JSON.stringify({ deleted: del.count }));
  } else if (cmd === "backfilltypes") {
    const rows = await prisma.event.findMany({
      where: { type: { in: ["slot.backfilled", "slot.coerced"] } },
      select: { type: true, payload: true },
    });
    const bf = {};
    const co = {};
    for (const r of rows) {
      const t = (r.payload && r.payload.type) || "?";
      if (r.type === "slot.backfilled") bf[t] = (bf[t] ?? 0) + 1;
      else co[t] = (co[t] ?? 0) + 1;
    }
    console.log(JSON.stringify({ backfilled: bf, coerced: co }));
  } else if (cmd === "reconcile") {
    // Cancellation by reconciliation [B3]: a session with lesson.started and NO
    // lesson.finished after N minutes IS cancelled. Stops racing Next's teardown.
    // ⚠️ REQUIRES A SCHEDULER — wire to Vercel Cron at deploy (Batch C). Built, not yet running.
    const minutes = Number(arg ?? 10);
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const started = await prisma.event.findMany({ where: { type: "lesson.started", createdAt: { lt: cutoff } }, select: { sessionId: true } });
    const finished = new Set(
      (await prisma.event.findMany({ where: { type: "lesson.finished" }, select: { sessionId: true } })).map((r) => r.sessionId),
    );
    const cancelled = [...new Set(started.map((r) => r.sessionId).filter((s) => s && !finished.has(s)))];
    console.log(JSON.stringify({ olderThanMinutes: minutes, cancelledSessions: cancelled.length, sessionIds: cancelled.slice(0, 50) }));
  } else {
    console.log("unknown cmd");
  }
} finally {
  await prisma.$disconnect();
}
