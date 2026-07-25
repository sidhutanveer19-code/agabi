import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * drainOutbox / outboxStats — the transient-write recovery drain.
 * The ONLY real I/O boundary (prisma) is stubbed; everything asserted here is the
 * module's OWN logic: row→Event field mapping, delete-only-after-insert ordering,
 * exponential backoff math (2**retryCount capped at 3600s), drained counting, and
 * the two defensive `-1` fallbacks. Adversarial inputs: dead query, dead reinsert,
 * dead outbox.update, dead count, provenance null vs present, huge retryCount.
 */

// Mutable per-test behaviour, hoisted above the vi.mock factory.
const h = vi.hoisted(() => ({
  findMany: (async () => [] as unknown[]) as (a?: unknown) => Promise<unknown[]>,
  eventCreate: (async () => {}) as (a: unknown) => Promise<unknown>,
  outboxDelete: (async () => {}) as (a: unknown) => Promise<unknown>,
  outboxUpdate: (async () => {}) as (a: unknown) => Promise<unknown>,
  count: (async () => 0) as () => Promise<number>,
  findFirst: (async () => null as unknown) as (a?: unknown) => Promise<unknown>,
}));

vi.mock("@/server/db", () => ({
  prisma: {
    outbox: {
      findMany: vi.fn((a: unknown) => h.findMany(a)),
      delete: vi.fn((a: unknown) => h.outboxDelete(a)),
      update: vi.fn((a: unknown) => h.outboxUpdate(a)),
      count: vi.fn(() => h.count()),
      findFirst: vi.fn((a: unknown) => h.findFirst(a)),
    },
    event: { create: vi.fn((a: unknown) => h.eventCreate(a)) },
  },
}));
vi.mock("@/server/log", () => ({ log: vi.fn() }));

const { drainOutbox, outboxStats } = await import("@/server/evidence/outbox");
const { prisma } = await import("@/server/db");
const create = prisma.event.create as unknown as ReturnType<typeof vi.fn>;
const del = prisma.outbox.delete as unknown as ReturnType<typeof vi.fn>;
const update = prisma.outbox.update as unknown as ReturnType<typeof vi.fn>;

function row(over: Record<string, unknown> = {}) {
  return {
    id: "evt_1", userId: "u1", type: "lesson.started", payload: { a: 1 },
    tier: 1, conversationId: "c1", lessonId: "l1", reqId: "r1",
    eventVersion: 2, schemaVersion: 3, provenance: null, causedByEventId: "cbe1",
    retryCount: 0, firstFailure: new Date("2020-01-01T00:00:00Z"),
    lastFailure: null, nextRetryAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findMany = async () => [];
  h.eventCreate = async () => {};
  h.outboxDelete = async () => {};
  h.outboxUpdate = async () => {};
  h.count = async () => 0;
  h.findFirst = async () => null;
});
afterEach(() => vi.useRealTimers());

describe("drainOutbox — happy drain", () => {
  it("drains every row, maps EXACT Event fields, deletes ONLY after insert, returns counts", async () => {
    h.findMany = async () => [row({ id: "a" }), row({ id: "b" })];
    h.count = async () => 0;

    const res = await drainOutbox();
    expect(res).toEqual({ drained: 2, remaining: 0 });

    // exact field mapping of first row (provenance null → undefined, source hardcoded)
    expect(create.mock.calls[0][0]).toEqual({
      data: {
        id: "a", userId: "u1", type: "lesson.started", payload: { a: 1 },
        source: "server", tier: 1, conversationId: "c1", lessonId: "l1", reqId: "r1",
        eventVersion: 2, schemaVersion: 3, provenance: undefined, causedByEventId: "cbe1",
      },
    });
    expect(del.mock.calls[0][0]).toEqual({ where: { id: "a" } });

    // delete of a row must happen AFTER its own insert
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(del.mock.invocationCallOrder[0]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it("present provenance is forwarded as-is (not undefined)", async () => {
    const prov = { via: "retry" };
    h.findMany = async () => [row({ provenance: prov })];
    await drainOutbox();
    expect(create.mock.calls[0][0].data.provenance).toBe(prov);
  });

  it("empty backlog → drains 0, still reports remaining from count", async () => {
    h.findMany = async () => [];
    h.count = async () => 7;
    expect(await drainOutbox()).toEqual({ drained: 0, remaining: 7 });
    expect(create).not.toHaveBeenCalled();
  });

  it("passes the limit through to findMany.take", async () => {
    h.findMany = async () => [];
    await drainOutbox(9);
    expect((prisma.outbox.findMany as unknown as { mock: { calls: Array<[{ take: number }]> } }).mock.calls[0][0].take).toBe(9);
  });
});

describe("drainOutbox — defensive fallbacks", () => {
  it("query failure → {drained:0, remaining:-1} and NO inserts attempted", async () => {
    h.findMany = async () => { throw new Error("db down"); };
    expect(await drainOutbox()).toEqual({ drained: 0, remaining: -1 });
    expect(create).not.toHaveBeenCalled();
  });

  it("count failure at the end → remaining falls back to -1 (drain still counted)", async () => {
    h.findMany = async () => [row({ id: "a" })];
    h.count = async () => { throw new Error("count boom"); };
    expect(await drainOutbox()).toEqual({ drained: 1, remaining: -1 });
  });
});

describe("drainOutbox — reinsert failure + exponential backoff", () => {
  it("insert throws → row NOT deleted, retryCount bumped, backoff = 2**retryCount seconds", async () => {
    vi.useFakeTimers();
    const now = new Date("2020-06-01T00:00:00Z");
    vi.setSystemTime(now);

    h.findMany = async () => [row({ id: "a", retryCount: 3 })]; // 2**3 = 8s
    h.eventCreate = async () => { throw new Error("reinsert failed"); };
    h.count = async () => 1;

    const res = await drainOutbox();
    expect(res).toEqual({ drained: 0, remaining: 1 });
    expect(del).not.toHaveBeenCalled();

    const u = update.mock.calls[0][0];
    expect(u.where).toEqual({ id: "a" });
    expect(u.data.retryCount).toEqual({ increment: 1 });
    expect(u.data.lastFailure).toEqual(now);
    expect((u.data.nextRetryAt as Date).getTime()).toBe(now.getTime() + 8 * 1000);
  });

  it("backoff is CAPPED at 3600s for huge retryCount", async () => {
    vi.useFakeTimers();
    const now = new Date("2020-06-01T00:00:00Z");
    vi.setSystemTime(now);

    h.findMany = async () => [row({ id: "a", retryCount: 20 })]; // 2**20 ≫ 3600
    h.eventCreate = async () => { throw new Error("x"); };

    await drainOutbox();
    const nextRetryAt = update.mock.calls[0][0].data.nextRetryAt as Date;
    expect(nextRetryAt.getTime()).toBe(now.getTime() + 3600 * 1000);
  });

  it("insert throws AND outbox.update throws → swallowed, no throw, drained stays 0", async () => {
    h.findMany = async () => [row({ id: "a" })];
    h.eventCreate = async () => { throw new Error("insert down"); };
    h.outboxUpdate = async () => { throw new Error("update down too"); };
    h.count = async () => 1;

    await expect(drainOutbox()).resolves.toEqual({ drained: 0, remaining: 1 });
  });

  it("mixed batch → good rows drain, bad row backs off, counts are exact", async () => {
    h.findMany = async () => [row({ id: "ok1" }), row({ id: "bad" }), row({ id: "ok2" })];
    h.eventCreate = async (a: unknown) => { if ((a as { data: { id: string } }).data.id === "bad") throw new Error("nope"); };
    h.count = async () => 1;

    expect(await drainOutbox()).toEqual({ drained: 2, remaining: 1 });
    expect(del).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: "bad" });
  });
});

describe("outboxStats", () => {
  it("computes backlog + oldestUnsyncedMs from the oldest firstFailure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:10Z")); // 10s after the failure
    h.count = async () => 4;
    h.findFirst = async () => ({ firstFailure: new Date("2020-01-01T00:00:00Z") });

    expect(await outboxStats()).toEqual({ backlog: 4, oldestUnsyncedMs: 10_000 });
  });

  it("empty outbox → oldestUnsyncedMs is null, backlog 0", async () => {
    h.count = async () => 0;
    h.findFirst = async () => null;
    expect(await outboxStats()).toEqual({ backlog: 0, oldestUnsyncedMs: null });
  });
});
