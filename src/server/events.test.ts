import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EmitInput } from "@/server/events";

/**
 * emit / emitMany / purgeUser / (get|reset)EvidenceHealth — the ONLY write path for
 * the flight recorder, and its FIX-2 tiered-durability matrix.
 *
 * The only real I/O edge (prisma) + the log sink are stubbed, and node:crypto's
 * randomUUID is made deterministic ("evt-0", "evt-1", …) so the id the caller gets
 * back can be asserted exactly. EVERYTHING else runs for real: the tier defaulting
 * (real `tierFor` from taxonomy.ts), the failure classification (real `classify`
 * from failure.ts), the row→Event/Outbox field mapping, the drop counters, and the
 * append-only purge arithmetic.
 *
 * Branch matrix asserted, per the tier matrix in events.ts:
 *   permanent (any tier)      → DROP, lesson CONTINUES; +droppedT1 only if T1.
 *   transient T3              → drop quietly (no retry, no Outbox, no log).
 *   transient T1/T2 + retry OK→ recorded via retry, no Outbox.
 *   transient + retry fails   → Outbox: OK → outboxUnavailable=false;
 *                               Outbox fails → T1 THROWS (+droppedT1), T2 logs+continues.
 * Plus every `??`/ternary default in createData & the Outbox row, both sides.
 */

// Deterministic ids at the crypto I/O edge (hoisted above the mock factory).
const uuid = vi.hoisted(() => ({ n: 0 }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const randomUUID = () => `evt-${uuid.n++}`;
  return { ...actual, randomUUID, default: { ...actual, randomUUID } };
});

// Mutable per-test prisma behaviour, hoisted above the vi.mock factory (outbox.test.ts pattern).
const h = vi.hoisted(() => ({
  eventCreate: (async () => {}) as (a: unknown) => Promise<unknown>,
  eventCreateMany: (async () => {}) as (a: unknown) => Promise<unknown>,
  outboxCreate: (async () => {}) as (a: unknown) => Promise<unknown>,
  eventDeleteMany: (async () => ({ count: 0 })) as (a?: unknown) => Promise<{ count: number }>,
  outboxDeleteMany: (async () => ({ count: 0 })) as (a?: unknown) => Promise<{ count: number }>,
}));

vi.mock("@/server/db", () => ({
  prisma: {
    event: {
      create: vi.fn((a: unknown) => h.eventCreate(a)),
      createMany: vi.fn((a: unknown) => h.eventCreateMany(a)),
      deleteMany: vi.fn((a: unknown) => h.eventDeleteMany(a)),
    },
    outbox: {
      create: vi.fn((a: unknown) => h.outboxCreate(a)),
      deleteMany: vi.fn((a: unknown) => h.outboxDeleteMany(a)),
    },
  },
}));
vi.mock("@/server/log", () => ({ log: vi.fn() }));

const { emit, emitMany, purgeUser, getEvidenceHealth, resetEvidenceHealth, EVENTS, CLIENT_EVENT_ALLOWLIST } =
  await import("@/server/events");
const { prisma } = await import("@/server/db");
const { log } = await import("@/server/log");

type MockFn = ReturnType<typeof vi.fn>;
const eventCreate = prisma.event.create as unknown as MockFn;
const eventCreateMany = prisma.event.createMany as unknown as MockFn;
const outboxCreate = prisma.outbox.create as unknown as MockFn;
const eventDeleteMany = prisma.event.deleteMany as unknown as MockFn;
const outboxDeleteMany = prisma.outbox.deleteMany as unknown as MockFn;
const logMock = log as unknown as MockFn;

/** the `.data` payload of the i-th call to a mocked prisma write. */
const dataOf = (fn: MockFn, i = 0) => (fn.mock.calls[i][0] as { data: Record<string, unknown> }).data;
/** a Prisma-shaped error carrying a `.code` (drives the real `classify`). */
const prismaErr = (code: string) => Object.assign(new Error(`prisma ${code}`), { code });

beforeEach(() => {
  vi.clearAllMocks();
  uuid.n = 0;
  h.eventCreate = async () => {};
  h.eventCreateMany = async () => {};
  h.outboxCreate = async () => {};
  h.eventDeleteMany = async () => ({ count: 0 });
  h.outboxDeleteMany = async () => ({ count: 0 });
  resetEvidenceHealth();
});
afterEach(() => vi.useRealTimers());

describe("emit — happy path + field mapping", () => {
  it("full meta: maps EXACT Event fields, honours an explicit tier, returns the persisted id", async () => {
    const id = await emit("u1", "lesson.started", { a: 1 }, "server", {
      conversationId: "c1", lessonId: "l1", reqId: "r1", tier: 3, // explicit tier overrides taxonomy's 1
      eventVersion: 5, schemaVersion: 9, provenance: { p: 1 }, causedByEventId: "cbe1",
    });

    expect(id).toBe("evt-0");
    expect(eventCreate).toHaveBeenCalledTimes(1);
    expect(dataOf(eventCreate)).toEqual({
      id: "evt-0", userId: "u1", type: "lesson.started", payload: { a: 1 }, source: "server",
      tier: 3, conversationId: "c1", lessonId: "l1", reqId: "r1",
      eventVersion: 5, schemaVersion: 9, provenance: { p: 1 }, causedByEventId: "cbe1",
    });
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
    expect(getEvidenceHealth()).toEqual({ droppedT1: 0, lastDropAt: null, outboxUnavailable: false });
  });

  it("no meta + null payload: all defaults applied (nulls, v1/v1, provenance→undefined, tier from taxonomy, {} payload)", async () => {
    const id = await emit("u2", "workspace.saved", null, "client"); // workspace.saved → tier 3

    expect(id).toBe("evt-0");
    expect(dataOf(eventCreate)).toEqual({
      id: "evt-0", userId: "u2", type: "workspace.saved", payload: {}, source: "client",
      tier: 3, conversationId: null, lessonId: null, reqId: null,
      eventVersion: 1, schemaVersion: 1, provenance: undefined, causedByEventId: null,
    });
  });

  it("unknown event type defaults to tier 2 (tierFor fallback)", async () => {
    await emit("u1", "totally.unknown.event", {}, "server");
    expect(dataOf(eventCreate).tier).toBe(2);
  });
});

describe("emit — permanent failure → DROP, lesson continues", () => {
  it("permanent + T1 (Prisma P2000): dropped, droppedT1++ & lastDropAt set, UNSAFE logged, still returns id, NO retry/outbox", async () => {
    vi.useFakeTimers();
    const t = new Date("2021-03-03T00:00:00Z");
    vi.setSystemTime(t);
    h.eventCreate = async () => { throw prismaErr("P2000"); }; // value too long → permanent

    const id = await emit("u1", "lesson.started", { a: 1 }, "server"); // tier 1

    expect(id).toBe("evt-0"); // caller still learns the id
    expect(eventCreate).toHaveBeenCalledTimes(1); // permanent ⇒ no retry
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(getEvidenceHealth()).toEqual({ droppedT1: 1, lastDropAt: t.getTime(), outboxUnavailable: false });
    expect(logMock).toHaveBeenCalledWith(
      "error", "evidence.dropped",
      expect.objectContaining({ userId: "u1", type: "lesson.started", tier: 1, message: "dropped lesson.started (tier 1): permanent" }),
      expect.any(Error),
    );
  });

  it("permanent + non-T1 (TypeError, tier 2): dropped WITHOUT touching droppedT1", async () => {
    h.eventCreate = async () => { throw new TypeError("BigInt cannot be serialized"); }; // → permanent

    const id = await emit("u2", "outline.planned", { a: 1 }, "server"); // tier 2

    expect(id).toBe("evt-0");
    expect(eventCreate).toHaveBeenCalledTimes(1);
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(getEvidenceHealth().droppedT1).toBe(0); // tier-2 drop must NOT count as lost T1 evidence
    expect(logMock).toHaveBeenCalledWith(
      "error", "evidence.dropped",
      expect.objectContaining({ type: "outline.planned", tier: 2, message: "dropped outline.planned (tier 2): permanent" }),
      expect.any(TypeError),
    );
  });
});

describe("emit — transient failure → tier matrix", () => {
  it("transient + T3: dropped quietly — no retry, no Outbox, no log, no counter", async () => {
    h.eventCreate = async () => { throw prismaErr("P1001"); }; // unreachable → transient

    const id = await emit("u1", "workspace.saved", { a: 1 }, "server"); // tier 3

    expect(id).toBe("evt-0");
    expect(eventCreate).toHaveBeenCalledTimes(1); // T3 returns before the retry
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
    expect(getEvidenceHealth().droppedT1).toBe(0);
  });

  it("transient + T1, retry SUCCEEDS: recorded on the 2nd insert, never reaches Outbox", async () => {
    let n = 0;
    h.eventCreate = async () => { if (n++ === 0) throw prismaErr("P1001"); }; // fail once, then ok

    const id = await emit("u1", "lesson.started", { a: 1 }, "server"); // tier 1

    expect(id).toBe("evt-0");
    expect(eventCreate).toHaveBeenCalledTimes(2); // initial + retry
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
    expect(getEvidenceHealth().droppedT1).toBe(0);
  });

  it("transient, retry FAILS, Outbox SUCCEEDS: full Outbox row mapping (no `source`), outboxUnavailable cleared", async () => {
    h.eventCreate = async () => { throw prismaErr("P1001"); }; // initial + retry both fail
    h.outboxCreate = async () => {};

    const id = await emit("u1", "lesson.started", { a: 1 }, "server", {
      conversationId: "c1", lessonId: "l1", reqId: "r1",
      eventVersion: 5, schemaVersion: 9, provenance: { p: 1 }, causedByEventId: "cbe1",
    });

    expect(id).toBe("evt-0");
    expect(eventCreate).toHaveBeenCalledTimes(2);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    expect(dataOf(outboxCreate)).toEqual({
      id: "evt-0", userId: "u1", tier: 1, type: "lesson.started", payload: { a: 1 },
      conversationId: "c1", lessonId: "l1", reqId: "r1",
      eventVersion: 5, schemaVersion: 9, provenance: { p: 1 }, causedByEventId: "cbe1",
    }); // note: Outbox row carries NO `source` column
    expect(getEvidenceHealth()).toEqual({ droppedT1: 0, lastDropAt: null, outboxUnavailable: false });
  });

  it("transient, retry FAILS, Outbox FAILS, T1: THROWS 'unrecordable', sets outboxUnavailable + droppedT1 (Outbox row uses defaults)", async () => {
    vi.useFakeTimers();
    const t = new Date("2020-06-01T00:00:00Z");
    vi.setSystemTime(t);
    h.eventCreate = async () => { throw prismaErr("P1001"); };
    h.outboxCreate = async () => { throw new Error("outbox dead"); };

    await expect(emit("u1", "lesson.started", { a: 1 }, "server")).rejects.toThrow(
      "Tier-1 evidence unrecordable (Event + Outbox both failed) for lesson.started",
    );

    expect(eventCreate).toHaveBeenCalledTimes(2);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    // Outbox row built with the default branches (ids→null, versions→1, provenance→undefined)
    expect(dataOf(outboxCreate)).toEqual({
      id: "evt-0", userId: "u1", tier: 1, type: "lesson.started", payload: { a: 1 },
      conversationId: null, lessonId: null, reqId: null,
      eventVersion: 1, schemaVersion: 1, provenance: undefined, causedByEventId: null,
    });
    expect(getEvidenceHealth()).toEqual({ droppedT1: 1, lastDropAt: t.getTime(), outboxUnavailable: true });
  });

  it("transient, retry FAILS, Outbox FAILS, T2: does NOT throw, logs evidence.outbox_failed, sets outboxUnavailable, leaves droppedT1", async () => {
    h.eventCreate = async () => { throw prismaErr("P1001"); };
    h.outboxCreate = async () => { throw new Error("outbox down"); };

    const id = await emit("u2", "outline.planned", { a: 1 }, "server"); // tier 2

    expect(id).toBe("evt-0"); // lesson continues
    expect(eventCreate).toHaveBeenCalledTimes(2);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    expect(getEvidenceHealth()).toEqual({ droppedT1: 0, lastDropAt: null, outboxUnavailable: true });
    expect(logMock).toHaveBeenCalledWith(
      "error", "evidence.outbox_failed",
      { userId: "u2", type: "outline.planned", tier: 2 },
      expect.any(Error),
    );
  });
});

describe("emitMany — batched write", () => {
  it("empty input: returns [] and never touches the DB", async () => {
    const res = await emitMany([]);
    expect(res).toEqual([]);
    expect(eventCreateMany).not.toHaveBeenCalled();
  });

  it("success: one createMany, DISTINCT ids returned, per-row tier defaulted, exact field mapping", async () => {
    const inputs: EmitInput[] = [
      { userId: "u1", type: "lesson.started", payload: { a: 1 }, source: "server", conversationId: "c1" },
      { userId: "u2", type: "workspace.saved", payload: { b: 2 }, source: "client" },
    ];

    const res = await emitMany(inputs);

    expect(res).toEqual(["evt-0", "evt-1"]); // distinct, order-preserving
    expect(eventCreateMany).toHaveBeenCalledTimes(1);
    const cm = eventCreateMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> };
    expect(cm.data).toHaveLength(2);
    expect(cm.data[0]).toEqual({
      id: "evt-0", userId: "u1", type: "lesson.started", payload: { a: 1 }, source: "server",
      tier: 1, conversationId: "c1", lessonId: null, reqId: null,
      eventVersion: 1, schemaVersion: 1, provenance: undefined, causedByEventId: null,
    });
    expect(cm.data[1]).toEqual({
      id: "evt-1", userId: "u2", type: "workspace.saved", payload: { b: 2 }, source: "client",
      tier: 3, conversationId: null, lessonId: null, reqId: null,
      eventVersion: 1, schemaVersion: 1, provenance: undefined, causedByEventId: null,
    });
    expect(eventCreate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it("batch fails PERMANENTLY: each row replays through the matrix by ITS OWN tier (only the T1 row counts), no retry", async () => {
    const inputs: EmitInput[] = [
      { userId: "u1", type: "lesson.started", payload: { a: 1 }, source: "server" },   // tier 1
      { userId: "u2", type: "workspace.saved", payload: { b: 2 }, source: "server" },   // tier 3
    ];
    h.eventCreateMany = async () => { throw prismaErr("P2000"); }; // permanent

    const res = await emitMany(inputs);

    expect(res).toEqual(["evt-0", "evt-1"]); // ids still returned
    expect(getEvidenceHealth().droppedT1).toBe(1); // only the tier-1 row counts as lost
    expect(eventCreate).not.toHaveBeenCalled(); // permanent ⇒ no per-row retry
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(logMock).toHaveBeenCalledTimes(2); // one evidence.dropped per row
  });

  it("batch fails TRANSIENTLY: the row is replayed and recovered via a per-row retry insert", async () => {
    const inputs: EmitInput[] = [
      { userId: "u1", type: "lesson.started", payload: { a: 1 }, source: "server" }, // tier 1
    ];
    h.eventCreateMany = async () => { throw prismaErr("P1001"); }; // transient
    h.eventCreate = async () => {}; // per-row retry succeeds

    const res = await emitMany(inputs);

    expect(res).toEqual(["evt-0"]);
    expect(eventCreate).toHaveBeenCalledTimes(1); // the recovery retry
    expect(dataOf(eventCreate)).toEqual(expect.objectContaining({ id: "evt-0", type: "lesson.started", source: "server" }));
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(getEvidenceHealth().droppedT1).toBe(0);
  });
});

describe("purgeUser — the one erasure path", () => {
  it("deletes Events AND Outbox for the user and returns the SUM of both counts", async () => {
    h.eventDeleteMany = async () => ({ count: 3 });
    h.outboxDeleteMany = async () => ({ count: 2 });

    const n = await purgeUser("u9");

    expect(n).toBe(5);
    expect(eventDeleteMany).toHaveBeenCalledWith({ where: { userId: "u9" } });
    expect(outboxDeleteMany).toHaveBeenCalledWith({ where: { userId: "u9" } });
  });

  it("nothing to erase: returns 0", async () => {
    expect(await purgeUser("nobody")).toBe(0);
  });
});

describe("evidence health — get/reset", () => {
  it("reports the clean initial state", () => {
    expect(getEvidenceHealth()).toEqual({ droppedT1: 0, lastDropAt: null, outboxUnavailable: false });
  });

  it("resetEvidenceHealth wipes droppedT1, lastDropAt AND outboxUnavailable back to baseline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    h.eventCreate = async () => { throw prismaErr("P1001"); };
    h.outboxCreate = async () => { throw new Error("dead"); };
    await expect(emit("u1", "lesson.started", {}, "server")).rejects.toThrow(); // dirties all three fields

    expect(getEvidenceHealth()).toEqual({
      droppedT1: 1, lastDropAt: new Date("2020-01-01T00:00:00Z").getTime(), outboxUnavailable: true,
    });

    resetEvidenceHealth();
    expect(getEvidenceHealth()).toEqual({ droppedT1: 0, lastDropAt: null, outboxUnavailable: false });
  });
});

describe("event taxonomy constants", () => {
  it("EVENTS maps camelCase keys to their dotted wire strings", () => {
    expect(EVENTS.lessonStarted).toBe("lesson.started");
    expect(EVENTS.error).toBe("error");
    expect(EVENTS.ingestChunksPersisted).toBe("ingest.chunks_persisted");
  });

  it("CLIENT_EVENT_ALLOWLIST admits exactly the 5 spoofable client events; server-only types are rejected", () => {
    expect(CLIENT_EVENT_ALLOWLIST.has("command.sent")).toBe(true);
    expect(CLIENT_EVENT_ALLOWLIST.has("topic_opened")).toBe(true);
    expect(CLIENT_EVENT_ALLOWLIST.has("question_asked")).toBe(true);
    expect(CLIENT_EVENT_ALLOWLIST.has("lesson.started")).toBe(false); // server-emitted, unspoofable
    expect(CLIENT_EVENT_ALLOWLIST.size).toBe(5);
  });
});
