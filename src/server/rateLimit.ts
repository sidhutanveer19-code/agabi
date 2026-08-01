import crypto from "node:crypto";
import { env } from "@/env";
import { prisma } from "@/server/db";

/**
 * Per-user sliding-window rate limit [I3]. In-memory (per server instance) — fine
 * for T0/T1; swap for Redis when horizontally scaled. Prevents an unmetered path
 * to the model.
 */
const hits = new Map<string, number[]>();

export function checkRateLimit(
  userId: string,
  limit = env.RATE_LIMIT_PER_MIN,
  windowMs = 60_000,
): { ok: boolean; remaining: number } {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(userId, recent);
    return { ok: false, remaining: 0 };
  }
  recent.push(now);
  hits.set(userId, recent);
  return { ok: true, remaining: limit - recent.length };
}

/** Test/maintenance helper — clear a user's window. */
export function resetRateLimit(userId?: string): void {
  if (userId) hits.delete(userId);
  else hits.clear();
}

/**
 * Shared Postgres rate limit [I3 / B1]. In-memory limiting is decorative on
 * serverless (cold starts reset it, instances don't share it); this counts hits
 * across all instances. **NOT YET WIRED** — the route keeps the in-memory limiter
 * until the `RateHit` migration runs. Uses raw SQL so it compiles before generate;
 * fail-OPEN on any DB error so a DB blip never locks every user out.
 */
export async function checkRateLimitShared(
  key: string,
  limit = env.RATE_LIMIT_PER_MIN,
  windowMs = 60_000,
): Promise<{ ok: boolean; remaining: number }> {
  try {
    const since = new Date(Date.now() - windowMs);
    const purgeBefore = new Date(Date.now() - 3_600_000); // prune rows older than 1h
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM "RateHit" WHERE key = ${key} AND "createdAt" > ${since}`;
      const count = Number(rows[0]?.n ?? 0);
      if (count >= limit) return { ok: false, remaining: 0 };
      await tx.$executeRaw`INSERT INTO "RateHit" (id, key, "createdAt") VALUES (${crypto.randomUUID()}, ${key}, now())`;
      await tx.$executeRaw`DELETE FROM "RateHit" WHERE "createdAt" < ${purgeBefore}`;
      return { ok: true, remaining: limit - count - 1 };
    });
  } catch {
    return { ok: true, remaining: limit }; // fail-open: never block on a DB error
  }
}
