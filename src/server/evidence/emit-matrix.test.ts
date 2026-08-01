import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * FIX 2 — the write-path matrix. A DETERMINISTIC bad payload must never take down
 * teaching; a genuinely-unrecordable Tier-1 write must stop the lesson (UNSAFE).
 */
let eventCreateErr: unknown = null;
let outboxCreateErr: unknown = null;

vi.mock("@/server/db", () => ({
  prisma: {
    event: { create: vi.fn(async () => { if (eventCreateErr) throw eventCreateErr; }) },
    outbox: { create: vi.fn(async () => { if (outboxCreateErr) throw outboxCreateErr; }) },
  },
}));
vi.mock("@/server/log", () => ({ log: () => {} }));

const { emit, getEvidenceHealth, resetEvidenceHealth } = await import("@/server/events");

beforeEach(() => { eventCreateErr = null; outboxCreateErr = null; resetEvidenceHealth(); });

describe("emit — tier matrix", () => {
  it("permanent failure (any tier) → resolves (lesson CONTINUES) + droppedT1++ + returns id", async () => {
    eventCreateErr = new TypeError("Do not know how to serialize a BigInt"); // permanent
    const id = await emit("u", "lesson.started", { bad: BigInt(1) }, "server", { tier: 1 });
    expect(typeof id).toBe("string");
    expect(getEvidenceHealth().droppedT1).toBe(1);
  });

  it("transient T1 + dead Outbox → THROWS (lesson stops / UNSAFE)", async () => {
    eventCreateErr = { code: "P1001" }; // transient (unreachable)
    outboxCreateErr = new Error("outbox also down");
    await expect(emit("u", "lesson.started", {}, "server", { tier: 1 })).rejects.toThrow();
    expect(getEvidenceHealth().droppedT1).toBe(1);
    expect(getEvidenceHealth().outboxUnavailable).toBe(true);
  });

  it("transient T2 + dead Outbox → does NOT throw (teaching continues)", async () => {
    eventCreateErr = { code: "P1001" };
    outboxCreateErr = new Error("down");
    await expect(emit("u", "slot.filled", {}, "server", { tier: 2 })).resolves.toBeTypeOf("string");
  });

  it("transient T1 recovered by the Outbox → no throw, nothing dropped", async () => {
    eventCreateErr = { code: "P1001" }; // both direct attempts fail
    outboxCreateErr = null; // Outbox catches it
    await expect(emit("u", "lesson.started", {}, "server", { tier: 1 })).resolves.toBeTypeOf("string");
    expect(getEvidenceHealth().droppedT1).toBe(0);
  });

  it("happy path → single insert, nothing dropped", async () => {
    const id = await emit("u", "lesson.started", {}, "server", { tier: 1 });
    expect(typeof id).toBe("string");
    expect(getEvidenceHealth().droppedT1).toBe(0);
  });
});
