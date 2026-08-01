import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * §H1 coverage for the [I3] rate limiter (`src/server/rateLimit.ts`) — both the
 * in-memory sliding window (`checkRateLimit` / `resetRateLimit`) and the shared
 * Postgres limiter (`checkRateLimitShared`).
 *
 * REAL code under test (never mocked): the sliding-window prune arithmetic, the
 * `>= limit` boundary, the exact `remaining` math on both branches, per-user
 * isolation, the two `resetRateLimit` branches, and the shared limiter's
 * count>=limit / count<limit / rows-empty / fail-open matrix including the exact
 * `since` and `purgeBefore` timestamps and the INSERT payload.
 *
 * Mocked ONLY at the two true I/O edges the module reaches through: prisma
 * (`@/server/db`) and `node:crypto`'s `randomUUID` (made deterministic so the
 * INSERT id is assertable). `env` is REAL — the default-param bindings resolve to
 * the real `env.RATE_LIMIT_PER_MIN`.
 */

// Deterministic uuid at the crypto I/O edge (hoisted above the mock factory).
const cryptoState = vi.hoisted(() => ({ uuid: "uuid-fixed" }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const randomUUID = () => cryptoState.uuid;
  return { ...actual, randomUUID, default: { ...actual, randomUUID } };
});

// Prisma stubbed at the boundary. `$transaction` runs the real callback with a tx
// exposing the mocked raw-SQL methods, so the module's own count/insert/prune logic
// executes for real.
const db = vi.hoisted(() => ({ queryRaw: vi.fn(), executeRaw: vi.fn() }));
vi.mock("@/server/db", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: db.queryRaw, $executeRaw: db.executeRaw }),
  },
}));

const { checkRateLimit, resetRateLimit, checkRateLimitShared } = await import("@/server/rateLimit");
const { env } = await import("@/env");

type MockFn = ReturnType<typeof vi.fn>;
const queryRaw = db.queryRaw as unknown as MockFn;
const executeRaw = db.executeRaw as unknown as MockFn;

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimit(); // clear the shared module-level in-memory window between tests
  cryptoState.uuid = "uuid-fixed";
  queryRaw.mockResolvedValue([{ n: BigInt(0) }]);
  executeRaw.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
// checkRateLimit — in-memory sliding window
// ---------------------------------------------------------------------------
describe("checkRateLimit — allow path + exact remaining", () => {
  it("first hit on a fresh user: ok, remaining = limit - 1 (empty-window ?? [] branch)", () => {
    expect(checkRateLimit("u", 3, 60_000)).toEqual({ ok: true, remaining: 2 });
  });

  it("counts DOWN by one per hit until the window is full, then rejects", () => {
    expect(checkRateLimit("u", 3, 60_000)).toEqual({ ok: true, remaining: 2 });
    expect(checkRateLimit("u", 3, 60_000)).toEqual({ ok: true, remaining: 1 });
    expect(checkRateLimit("u", 3, 60_000)).toEqual({ ok: true, remaining: 0 }); // last allowed
    // window now holds exactly `limit` entries -> the >= branch fires
    expect(checkRateLimit("u", 3, 60_000)).toEqual({ ok: false, remaining: 0 });
  });

  it("a rejected hit is NOT recorded — it stays rejected, never leaks capacity back", () => {
    checkRateLimit("u", 1, 60_000); // fills the single slot (remaining 0)
    expect(checkRateLimit("u", 1, 60_000)).toEqual({ ok: false, remaining: 0 });
    expect(checkRateLimit("u", 1, 60_000)).toEqual({ ok: false, remaining: 0 });
  });

  it("boundary: limit is reached at exactly `limit` hits, not limit+1", () => {
    // limit 2: two allowed, third rejected — proves `>=` (not `>`)
    expect(checkRateLimit("u", 2, 60_000).ok).toBe(true);
    expect(checkRateLimit("u", 2, 60_000).ok).toBe(true);
    expect(checkRateLimit("u", 2, 60_000).ok).toBe(false);
  });

  it("windows are per-user: filling user A never limits user B", () => {
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(true);
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(false); // A is full
    expect(checkRateLimit("b", 1, 60_000)).toEqual({ ok: true, remaining: 0 }); // B untouched
  });

  it("uses env.RATE_LIMIT_PER_MIN as the default limit", () => {
    const first = checkRateLimit("u"); // no limit arg
    expect(first).toEqual({ ok: true, remaining: env.RATE_LIMIT_PER_MIN - 1 });
    // exhaust the remaining default capacity
    for (let i = 1; i < env.RATE_LIMIT_PER_MIN; i++) {
      expect(checkRateLimit("u").ok).toBe(true);
    }
    expect(checkRateLimit("u")).toEqual({ ok: false, remaining: 0 }); // (limit+1)-th rejected
  });
});

describe("checkRateLimit — sliding-window prune arithmetic (default windowMs)", () => {
  it("drops entries once they age past the window and frees capacity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    // window 1000ms, limit 5
    expect(checkRateLimit("u", 5, 1000)).toEqual({ ok: true, remaining: 4 }); // t=0 -> [0]

    vi.setSystemTime(999); // 999 - 0 = 999 < 1000 -> the t=0 hit is KEPT
    expect(checkRateLimit("u", 5, 1000)).toEqual({ ok: true, remaining: 3 }); // [0,999]

    vi.setSystemTime(1000); // 1000 - 0 = 1000 is NOT < 1000 -> t=0 hit is PRUNED
    // window becomes [999] then pushes 1000 -> length 2 -> remaining 5 - 2 = 3 (not 2)
    expect(checkRateLimit("u", 5, 1000)).toEqual({ ok: true, remaining: 3 });
  });

  it("a full window recovers to ok once every entry ages out", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    checkRateLimit("u", 1, 1000); // fill
    vi.setSystemTime(500);
    expect(checkRateLimit("u", 1, 1000).ok).toBe(false); // 500-0=500 < 1000 -> still full
    vi.setSystemTime(1000);
    expect(checkRateLimit("u", 1, 1000)).toEqual({ ok: true, remaining: 0 }); // aged out
  });

  it("defaults windowMs to 60_000: a 59_999ms-old hit is kept, a 60_000ms-old hit is dropped", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    checkRateLimit("u", 2); // default window, [0]
    vi.setSystemTime(59_999);
    expect(checkRateLimit("u", 2).ok).toBe(true); // [0,59999] -> now full
    expect(checkRateLimit("u", 2).ok).toBe(false); // still full within 60s
    vi.setSystemTime(60_000); // the t=0 hit is now exactly 60_000 old -> pruned
    expect(checkRateLimit("u", 2)).toEqual({ ok: true, remaining: 0 }); // [59999] + push
  });
});

// ---------------------------------------------------------------------------
// resetRateLimit — both branches
// ---------------------------------------------------------------------------
describe("resetRateLimit", () => {
  it("with a userId: clears ONLY that user's window, leaving others intact", () => {
    checkRateLimit("a", 1, 60_000); // a full
    checkRateLimit("b", 1, 60_000); // b full
    resetRateLimit("a");
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(true); // a reset -> allowed again
    expect(checkRateLimit("b", 1, 60_000).ok).toBe(false); // b untouched -> still full
  });

  it("with no argument (undefined): clears every user's window", () => {
    checkRateLimit("a", 1, 60_000);
    checkRateLimit("b", 1, 60_000);
    resetRateLimit();
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(true);
    expect(checkRateLimit("b", 1, 60_000).ok).toBe(true);
  });

  it("with an empty-string userId (falsy): takes the clear-all branch", () => {
    checkRateLimit("a", 1, 60_000);
    checkRateLimit("b", 1, 60_000);
    resetRateLimit(""); // "" is falsy -> hits.clear(), not hits.delete("")
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(true);
    expect(checkRateLimit("b", 1, 60_000).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkRateLimitShared — Postgres-backed limiter
// ---------------------------------------------------------------------------
describe("checkRateLimitShared — allow path", () => {
  it("count below limit: inserts a hit, prunes old rows, returns remaining = limit - count - 1", async () => {
    queryRaw.mockResolvedValue([{ n: BigInt(2) }]);
    const res = await checkRateLimitShared("k", 5, 60_000);
    expect(res).toEqual({ ok: true, remaining: 2 }); // 5 - 2 - 1

    // the SELECT ran with the right key
    expect(queryRaw.mock.calls[0]![1]).toBe("k");
    // INSERT ran first (deterministic uuid + key), then the DELETE prune
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(executeRaw.mock.calls[0]![1]).toBe("uuid-fixed"); // id
    expect(executeRaw.mock.calls[0]![2]).toBe("k"); // key
  });

  it("empty count rows: `?? 0` treats it as zero and allows (remaining = limit - 1)", async () => {
    queryRaw.mockResolvedValue([]); // rows[0]?.n is undefined -> ?? 0
    const res = await checkRateLimitShared("k", 5, 60_000);
    expect(res).toEqual({ ok: true, remaining: 4 });
    expect(executeRaw).toHaveBeenCalledTimes(2); // still inserted
  });

  it("count === limit - 1 (last slot): allowed with remaining 0 — NOT a rejection", async () => {
    queryRaw.mockResolvedValue([{ n: BigInt(4) }]);
    expect(await checkRateLimitShared("k", 5, 60_000)).toEqual({ ok: true, remaining: 0 });
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("uses env.RATE_LIMIT_PER_MIN as the default limit", async () => {
    queryRaw.mockResolvedValue([{ n: BigInt(0) }]);
    const res = await checkRateLimitShared("k"); // default limit + window
    expect(res).toEqual({ ok: true, remaining: env.RATE_LIMIT_PER_MIN - 1 });
  });

  it("passes the correct `since` (now - windowMs) and `purgeBefore` (now - 1h) timestamps", async () => {
    vi.useFakeTimers();
    const t = new Date("2026-01-01T00:00:00.000Z").getTime();
    vi.setSystemTime(t);
    queryRaw.mockResolvedValue([{ n: BigInt(0) }]);

    await checkRateLimitShared("k", 5, 60_000);

    const since = queryRaw.mock.calls[0]![2] as Date; // WHERE createdAt > ${since}
    expect(since.getTime()).toBe(t - 60_000);

    const purgeBefore = executeRaw.mock.calls[1]![1] as Date; // DELETE ... < ${purgeBefore}
    expect(purgeBefore.getTime()).toBe(t - 3_600_000);
  });
});

describe("checkRateLimitShared — reject path", () => {
  it("count === limit: rejects, remaining 0, and does NOT insert", async () => {
    queryRaw.mockResolvedValue([{ n: BigInt(5) }]);
    expect(await checkRateLimitShared("k", 5, 60_000)).toEqual({ ok: false, remaining: 0 });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("count above limit: rejects, remaining 0, no insert", async () => {
    queryRaw.mockResolvedValue([{ n: BigInt(9) }]);
    expect(await checkRateLimitShared("k", 5, 60_000)).toEqual({ ok: false, remaining: 0 });
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe("checkRateLimitShared — fail-open on DB error (never lock users out)", () => {
  it("SELECT throws: catches and returns ok with remaining = limit", async () => {
    queryRaw.mockRejectedValue(new Error("db down"));
    expect(await checkRateLimitShared("k", 7, 60_000)).toEqual({ ok: true, remaining: 7 });
    expect(executeRaw).not.toHaveBeenCalled(); // never reached the insert
  });

  it("INSERT throws mid-transaction: still fails OPEN with remaining = limit", async () => {
    queryRaw.mockResolvedValue([{ n: BigInt(0) }]); // count check passes
    executeRaw.mockRejectedValueOnce(new Error("write failed")); // the INSERT blows up
    expect(await checkRateLimitShared("k", 7, 60_000)).toEqual({ ok: true, remaining: 7 });
  });

  it("fail-open uses the DEFAULT limit when none is passed", async () => {
    queryRaw.mockRejectedValue(new Error("db down"));
    expect(await checkRateLimitShared("k")).toEqual({ ok: true, remaining: env.RATE_LIMIT_PER_MIN });
  });
});
