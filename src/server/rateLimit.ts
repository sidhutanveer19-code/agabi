import { env } from "@/env";

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
