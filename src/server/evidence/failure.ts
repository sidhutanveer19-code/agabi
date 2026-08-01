/**
 * Classify an evidence-write failure so a DETERMINISTIC failure (payload over a
 * column limit, an unserializable value, a bad enum) can never become a total
 * teaching outage: it fails the Event insert AND the Outbox insert identically, so
 * retrying/queuing is futile — drop it, raise UNSAFE, but let the lesson continue.
 * Only a genuinely transient failure (DB unreachable/timeout/pool) is worth the
 * retry → Outbox → (tier-1) throw path.
 */
export type FailureKind = "transient" | "permanent";

export function classify(e: unknown): FailureKind {
  const err = e as { code?: string; errorCode?: string };
  const code = err?.code ?? err?.errorCode; // Prisma KnownRequestError.code / InitializationError.errorCode

  // unreachable / timed out / pool exhausted — retrying is exactly right
  if (code === "P1001" || code === "P1002" || code === "P1008" || code === "P2024") return "transient";

  // value too long / invalid value / validation — retrying is pointless
  if (code === "P2000" || code === "P2006" || code === "P2007") return "permanent";

  // BigInt / circular JSON — deterministic, will fail identically forever
  if (e instanceof TypeError || e instanceof RangeError) return "permanent";

  return "transient"; // unknown → assume retryable; the Outbox absorbs it
}
