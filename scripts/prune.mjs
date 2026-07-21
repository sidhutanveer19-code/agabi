// Event retention prune [B5] — deletes Events older than 90 days. Keeps purgeUser
// (per-user erasure) untouched. The 90-day number is also a DPDP input.
//
// ⚠️ REQUIRES A SCHEDULER — this is a one-shot script. Wire it to Vercel Cron at
// deploy (Batch C). Until then it does nothing on its own. "Built, not yet running."
//
// Run manually: node --env-file=.env.local scripts/prune.mjs [days]
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const days = Number(process.argv[2] ?? 90);
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
try {
  const del = await prisma.event.deleteMany({ where: { createdAt: { lt: cutoff } } });
  console.log(JSON.stringify({ prunedOlderThanDays: days, deleted: del.count, cutoff: cutoff.toISOString() }));
} finally {
  await prisma.$disconnect();
}
