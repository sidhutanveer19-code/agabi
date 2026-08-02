import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OutlineSlot } from "@/server/conversation/outline";

/**
 * lessonRepo — the ONLY writers of lesson/session state.
 * The single real I/O boundary (prisma) is stubbed at the edge; everything asserted
 * here is the module's OWN logic run for REAL: `normalizeSlot`'s backward-compatible
 * slot read (against the REAL, un-mocked SLOT_STATES), `toRow`'s null-slots fallback +
 * field mapping, and `setSlotStates`' merge-by-array-index. Every prisma query's exact
 * args are asserted (where/select/data/orderBy), and every early-return / conditional
 * branch is exercised with the concrete output named.
 */

// Mutable per-test behaviour, hoisted above the vi.mock factory.
const h = vi.hoisted(() => ({
  sessionUpsert: (async () => ({ id: "s1", activeLessonId: null })) as (a: unknown) => Promise<unknown>,
  lessonFindMany: (async () => [] as unknown[]) as (a?: unknown) => Promise<unknown[]>,
  lessonFindUnique: (async () => null as unknown) as (a?: unknown) => Promise<unknown>,
  lessonCreate: (async () => ({})) as (a: unknown) => Promise<unknown>,
  lessonUpdate: (async () => ({})) as (a: unknown) => Promise<unknown>,
  lessonUpdateMany: (async () => ({ count: 1 })) as (a: unknown) => Promise<unknown>,
}));

vi.mock("@/server/db", () => ({
  prisma: {
    session: { upsert: vi.fn((a: unknown) => h.sessionUpsert(a)) },
    lesson: {
      findMany: vi.fn((a: unknown) => h.lessonFindMany(a)),
      findUnique: vi.fn((a: unknown) => h.lessonFindUnique(a)),
      create: vi.fn((a: unknown) => h.lessonCreate(a)),
      update: vi.fn((a: unknown) => h.lessonUpdate(a)),
      updateMany: vi.fn((a: unknown) => h.lessonUpdateMany(a)),
    },
  },
}));

const repo = await import("@/server/conversation/lessonRepo");
const { prisma } = await import("@/server/db");

const sessionUpsert = prisma.session.upsert as unknown as ReturnType<typeof vi.fn>;
const findMany = prisma.lesson.findMany as unknown as ReturnType<typeof vi.fn>;
const findUnique = prisma.lesson.findUnique as unknown as ReturnType<typeof vi.fn>;
const create = prisma.lesson.create as unknown as ReturnType<typeof vi.fn>;
const update = prisma.lesson.update as unknown as ReturnType<typeof vi.fn>;
const updateMany = prisma.lesson.updateMany as unknown as ReturnType<typeof vi.fn>;

/** A realistic persisted Lesson row (what prisma returns). Minimal to the fields toRow reads. */
function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: "l1",
    userId: "u1",
    canvasId: "c1",
    regionId: "reg1",
    topic: "Quadratics",
    slots: [{ slot: 1, type: "heading", intent: "Quadratics", state: "READY" }],
    cursor: 0,
    state: "TEACHING",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUpsert = async () => ({ id: "s1", activeLessonId: null });
  h.lessonFindMany = async () => [];
  h.lessonFindUnique = async () => null;
  h.lessonCreate = async () => dbRow();
  h.lessonUpdate = async () => dbRow();
  h.lessonUpdateMany = async () => ({ count: 1 });
});

// ---------------------------------------------------------------------------
// normalizeSlot — the backward-compatible slot read (FIX 3). Real SLOT_STATES.
// ---------------------------------------------------------------------------
describe("normalizeSlot", () => {
  it("keeps every REAL SlotState verbatim (never forces READY over a real state)", () => {
    for (const state of ["PLANNED", "GENERATING", "READY", "FAILED", "SKIPPED"] as const) {
      expect(repo.normalizeSlot({ slot: 3, type: "flow", intent: "x", state })).toEqual({
        slot: 3,
        type: "flow",
        intent: "x",
        state,
      });
    }
  });

  it("absent state (pre-Stage-B row) reads as READY, not FAILED", () => {
    expect(repo.normalizeSlot({ slot: 2, type: "paragraph", intent: "why it matters" })).toEqual({
      slot: 2,
      type: "paragraph",
      intent: "why it matters",
      state: "READY",
    });
  });

  it("unrecognised state string degrades to READY", () => {
    expect(repo.normalizeSlot({ slot: 5, type: "table", intent: "cases", state: "GARBAGE" })).toEqual({
      slot: 5,
      type: "table",
      intent: "cases",
      state: "READY",
    });
  });

  it("empty-string state (present but blank) → READY", () => {
    expect(repo.normalizeSlot({ slot: 1, type: "heading", intent: "t", state: "" }).state).toBe("READY");
  });

  it("preserves the other fields untouched while defaulting state", () => {
    const out = repo.normalizeSlot({ slot: 9, type: "summary", intent: "recap", state: "nope" });
    expect(out.slot).toBe(9);
    expect(out.type).toBe("summary");
    expect(out.intent).toBe("recap");
    expect(out.state).toBe("READY");
  });
});

// ---------------------------------------------------------------------------
// getSession — session.upsert wiring
// ---------------------------------------------------------------------------
describe("getSession", () => {
  it("upserts by the composite key and returns exactly {id, activeLessonId}", async () => {
    h.sessionUpsert = async () => ({ id: "sess_9", activeLessonId: "les_7" });

    const res = await repo.getSession("u1", "c1");
    expect(res).toEqual({ id: "sess_9", activeLessonId: "les_7" });
    expect(sessionUpsert).toHaveBeenCalledWith({
      where: { userId_canvasId: { userId: "u1", canvasId: "c1" } },
      update: {},
      create: { userId: "u1", canvasId: "c1" },
      select: { id: true, activeLessonId: true },
    });
  });
});

// ---------------------------------------------------------------------------
// getLessons — findMany + toRow mapping
// ---------------------------------------------------------------------------
describe("getLessons", () => {
  it("empty result → [] (no rows to map)", async () => {
    h.lessonFindMany = async () => [];
    expect(await repo.getLessons("u1", "c1")).toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1", canvasId: "c1" },
      orderBy: { createdAt: "asc" },
    });
  });

  it("maps every row through toRow, in the returned order", async () => {
    h.lessonFindMany = async () => [
      dbRow({ id: "l1", topic: "A", slots: [{ slot: 1, type: "heading", intent: "A", state: "READY" }] }),
      dbRow({ id: "l2", topic: "B", slots: null }),
    ];
    const res = await repo.getLessons("u1", "c1");
    expect(res.map((r) => r.id)).toEqual(["l1", "l2"]);
    // second row had null slots → normalized to []
    expect(res[1].slots).toEqual([]);
    expect(res[0].slots).toEqual([{ slot: 1, type: "heading", intent: "A", state: "READY" }]);
  });
});

// ---------------------------------------------------------------------------
// getLesson + toRow — found / not-found, null slots, state normalization
// ---------------------------------------------------------------------------
describe("getLesson / toRow", () => {
  it("found → full LessonRow with slots normalized and state cast", async () => {
    h.lessonFindUnique = async () =>
      dbRow({
        slots: [
          { slot: 1, type: "heading", intent: "Q", state: "GENERATING" }, // valid → kept
          { slot: 2, type: "paragraph", intent: "b" }, // no state → READY
          { slot: 3, type: "flow", intent: "c", state: "BOGUS" }, // invalid → READY
        ],
      });

    expect(await repo.getLesson("l1")).toEqual({
      id: "l1",
      userId: "u1",
      canvasId: "c1",
      regionId: "reg1",
      topic: "Quadratics",
      cursor: 0,
      state: "TEACHING",
      slots: [
        { slot: 1, type: "heading", intent: "Q", state: "GENERATING" },
        { slot: 2, type: "paragraph", intent: "b", state: "READY" },
        { slot: 3, type: "flow", intent: "c", state: "READY" },
      ],
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "l1" } });
  });

  it("not found → null (toRow never invoked)", async () => {
    h.lessonFindUnique = async () => null;
    expect(await repo.getLesson("missing")).toBeNull();
  });

  it("null slots column → slots normalized to []", async () => {
    h.lessonFindUnique = async () => dbRow({ slots: null });
    const res = await repo.getLesson("l1");
    expect(res?.slots).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getActiveLesson — session → maybe lesson
// ---------------------------------------------------------------------------
describe("getActiveLesson", () => {
  it("no active lesson on the session → null, and lesson.findUnique is NOT called", async () => {
    h.sessionUpsert = async () => ({ id: "s1", activeLessonId: null });
    expect(await repo.getActiveLesson("u1", "c1")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("active lesson present + row exists → returns that lesson via getLesson(activeLessonId)", async () => {
    h.sessionUpsert = async () => ({ id: "s1", activeLessonId: "act_42" });
    h.lessonFindUnique = async () => dbRow({ id: "act_42", slots: [] });

    const res = await repo.getActiveLesson("u1", "c1");
    expect(res?.id).toBe("act_42");
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "act_42" } });
  });

  it("active lesson id set but the row was deleted → null", async () => {
    h.sessionUpsert = async () => ({ id: "s1", activeLessonId: "gone" });
    h.lessonFindUnique = async () => null;
    expect(await repo.getActiveLesson("u1", "c1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createLesson — exact create payload + toRow of the result
// ---------------------------------------------------------------------------
describe("createLesson", () => {
  it("writes cursor 0 / state IDLE, passes slots through, returns toRow of the created row", async () => {
    const slots: OutlineSlot[] = [
      { slot: 1, type: "heading", intent: "Newton's laws" },
      { slot: 2, type: "flow", intent: "how motion changes", state: "PLANNED" },
    ];
    h.lessonCreate = async () =>
      dbRow({ id: "new1", topic: "Newton", regionId: "regZ", slots });

    const res = await repo.createLesson("u1", "c1", "Newton", "regZ", slots);

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        canvasId: "c1",
        topic: "Newton",
        regionId: "regZ",
        slots,
        cursor: 0,
        state: "IDLE",
      },
    });
    // toRow normalized: slot 1 (no state) → READY, slot 2 kept PLANNED
    expect(res).toEqual({
      id: "new1",
      userId: "u1",
      canvasId: "c1",
      regionId: "regZ",
      topic: "Newton",
      cursor: 0,
      state: "TEACHING",
      slots: [
        { slot: 1, type: "heading", intent: "Newton's laws", state: "READY" },
        { slot: 2, type: "flow", intent: "how motion changes", state: "PLANNED" },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// setActiveLesson — upsert with a concrete id and with null
// ---------------------------------------------------------------------------
describe("setActiveLesson", () => {
  it("sets a concrete active lesson id (update + create both carry it)", async () => {
    await repo.setActiveLesson("u1", "c1", "les_5");
    expect(sessionUpsert).toHaveBeenCalledWith({
      where: { userId_canvasId: { userId: "u1", canvasId: "c1" } },
      update: { activeLessonId: "les_5" },
      create: { userId: "u1", canvasId: "c1", activeLessonId: "les_5" },
    });
  });

  it("clears the active lesson with null", async () => {
    await repo.setActiveLesson("u1", "c1", null);
    expect(sessionUpsert).toHaveBeenCalledWith({
      where: { userId_canvasId: { userId: "u1", canvasId: "c1" } },
      update: { activeLessonId: null },
      create: { userId: "u1", canvasId: "c1", activeLessonId: null },
    });
  });

  it("returns undefined (void)", async () => {
    expect(await repo.setActiveLesson("u1", "c1", "x")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// advanceCursor — increment + toRow
// ---------------------------------------------------------------------------
describe("advanceCursor", () => {
  it("increments the cursor by `by` and returns the updated row via toRow", async () => {
    h.lessonUpdate = async () => dbRow({ cursor: 5, slots: [] });
    const res = await repo.advanceCursor("l1", 2);
    expect(update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { cursor: { increment: 2 } } });
    expect(res.cursor).toBe(5);
    expect(res.slots).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// setLessonState — plain state write, void return
// ---------------------------------------------------------------------------
describe("setLessonState — compare-and-set", () => {
  it("writes only while the row still reads `from`, and reports that it applied", async () => {
    h.lessonUpdateMany = async () => ({ count: 1 });
    const out = await repo.setLessonState("l1", "TEACHING", "COMPLETED");
    // The `state: from` predicate is the whole point: without it two overlapping requests can each
    // decide a transition from a state that no longer exists, and the later write silently wins.
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "l1", state: "TEACHING" }, data: { state: "COMPLETED" } });
    expect(out).toBe(true);
  });

  it("reports FALSE when the row moved first — the caller's transition did not happen", async () => {
    h.lessonUpdateMany = async () => ({ count: 0 });
    expect(await repo.setLessonState("l1", "TEACHING", "COMPLETED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setSlotStates — merge per-slot states by array index
// ---------------------------------------------------------------------------
describe("setSlotStates", () => {
  it("empty updates → early return: NO read, NO write", async () => {
    await repo.setSlotStates("l1", []);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("lesson not found → reads once, then returns without writing", async () => {
    h.lessonFindUnique = async () => null;
    await repo.setSlotStates("l1", [{ index: 0, state: "FAILED" }]);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "l1" }, select: { slots: true } });
    expect(update).not.toHaveBeenCalled();
  });

  it("null slots column → normalizes to [], writes an empty slots array", async () => {
    h.lessonFindUnique = async () => ({ slots: null });
    await repo.setSlotStates("l1", [{ index: 0, state: "READY" }]);
    expect(update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { slots: [] } });
  });

  it("merges only the targeted indices; untargeted slots keep their normalized state; out-of-range index is ignored", async () => {
    h.lessonFindUnique = async () => ({
      slots: [
        { slot: 1, type: "heading", intent: "a", state: "GENERATING" }, // targeted → FAILED
        { slot: 2, type: "paragraph", intent: "b" }, // untargeted, no state → READY
        { slot: 3, type: "flow", intent: "c", state: "NONSENSE" }, // targeted (invalid→READY) → SKIPPED
      ],
    });

    await repo.setSlotStates("l1", [
      { index: 0, state: "FAILED" },
      { index: 2, state: "SKIPPED" },
      { index: 9, state: "READY" }, // no such slot → dropped
    ]);

    expect(update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: {
        slots: [
          { slot: 1, type: "heading", intent: "a", state: "FAILED" },
          { slot: 2, type: "paragraph", intent: "b", state: "READY" },
          { slot: 3, type: "flow", intent: "c", state: "SKIPPED" },
        ],
      },
    });
  });

  it("returns undefined (void) on a successful merge", async () => {
    h.lessonFindUnique = async () => ({ slots: [{ slot: 1, type: "heading", intent: "a", state: "READY" }] });
    expect(await repo.setSlotStates("l1", [{ index: 0, state: "SKIPPED" }])).toBeUndefined();
  });
});
