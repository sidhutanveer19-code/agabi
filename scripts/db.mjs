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
  } else {
    console.log("unknown cmd");
  }
} finally {
  await prisma.$disconnect();
}
