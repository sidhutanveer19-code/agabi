import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LessonRow } from "@/server/conversation/lessonRepo";
import type { OutlineSlot } from "@/server/conversation/outline";

/**
 * buildCanvasContext + its private coveredTypes() — the deterministic canvas-context
 * builder. The ONLY I/O edge is the lesson repo (getActiveLesson / getLessons), which
 * is stubbed here; everything asserted is the module's OWN logic:
 *   - Promise.all fan-out: BOTH repo reads fire with (userId, canvasId)
 *   - focusedRegionId = current?.regionId ?? null  (null when no active; the regionId
 *     when active; and "" is KEPT — proves ?? not ||)
 *   - previousLessons = all.filter(l => l.id !== current?.id).map(...)
 *       · current null  → current?.id undefined → NOTHING filtered (all kept)
 *       · current in list → the active row removed
 *       · current NOT in list → filter removes nothing (map over the full list)
 *       · empty list → []
 *   - coveredTypes: skip "heading"/"summary" BY TYPE (not position), dedupe keeping
 *     first-occurrence order, [] when all-skipped or slots empty
 *   - currentLesson / canvasId are echoed verbatim (reference-preserving)
 */

// Mutable per-test behaviour, hoisted above the vi.mock factory.
const h = vi.hoisted(() => ({
  active: (async () => null as unknown) as (u: string, c: string) => Promise<unknown>,
  lessons: (async () => [] as unknown[]) as (u: string, c: string) => Promise<unknown[]>,
}));

vi.mock("@/server/conversation/lessonRepo", () => ({
  getActiveLesson: vi.fn((u: string, c: string) => h.active(u, c)),
  getLessons: vi.fn((u: string, c: string) => h.lessons(u, c)),
}));

const { buildCanvasContext } = await import("@/server/conversation/context");
const { getActiveLesson, getLessons } = await import("@/server/conversation/lessonRepo");
const activeFn = getActiveLesson as unknown as ReturnType<typeof vi.fn>;
const lessonsFn = getLessons as unknown as ReturnType<typeof vi.fn>;

function slot(type: string, slotNum = 1): OutlineSlot {
  return { slot: slotNum, type, intent: `intent-${type}`, state: "READY" };
}

function lesson(over: Partial<LessonRow> = {}): LessonRow {
  return {
    id: "l1",
    userId: "u1",
    canvasId: "c1",
    regionId: "r1",
    topic: "Photosynthesis",
    cursor: 0,
    state: "TEACHING",
    slots: [slot("heading", 1), slot("paragraph", 2), slot("summary", 3)],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.active = async () => null;
  h.lessons = async () => [];
});

describe("buildCanvasContext — no active lesson", () => {
  it("current null → focusedRegionId null, nothing filtered, EXACT previousLessons + coveredTypes", async () => {
    const la = lesson({
      id: "la",
      topic: "Acids",
      regionId: "rA",
      state: "COMPLETED",
      // list appears twice → deduped to one; heading/summary skipped
      slots: [slot("heading", 1), slot("list", 2), slot("paragraph", 3), slot("list", 4), slot("summary", 5)],
    });
    const lb = lesson({
      id: "lb",
      topic: "Bases",
      regionId: "rB",
      state: "PARTIAL",
      // only bookends → coveredTypes is []
      slots: [slot("heading", 1), slot("summary", 2)],
    });
    h.active = async () => null;
    h.lessons = async () => [la, lb];

    const ctx = await buildCanvasContext("user-9", "canvas-9");

    expect(ctx).toEqual({
      canvasId: "canvas-9",
      currentLesson: null,
      focusedRegionId: null,
      previousLessons: [
        { id: "la", topic: "Acids", regionId: "rA", state: "COMPLETED", coveredTypes: ["list", "paragraph"] },
        { id: "lb", topic: "Bases", regionId: "rB", state: "PARTIAL", coveredTypes: [] },
      ],
    });
  });

  it("fans out via Promise.all: BOTH repo reads fire exactly once with (userId, canvasId)", async () => {
    h.active = async () => null;
    h.lessons = async () => [];

    await buildCanvasContext("user-9", "canvas-9");

    expect(activeFn).toHaveBeenCalledTimes(1);
    expect(lessonsFn).toHaveBeenCalledTimes(1);
    expect(activeFn).toHaveBeenCalledWith("user-9", "canvas-9");
    expect(lessonsFn).toHaveBeenCalledWith("user-9", "canvas-9");
  });

  it("empty lesson list → previousLessons is []", async () => {
    h.active = async () => null;
    h.lessons = async () => [];

    expect(await buildCanvasContext("u", "c")).toEqual({
      canvasId: "c",
      currentLesson: null,
      focusedRegionId: null,
      previousLessons: [],
    });
  });
});

describe("buildCanvasContext — active lesson present", () => {
  it("active row IS in the list → currentLesson echoed, focusedRegionId = regionId, active FILTERED out of previous", async () => {
    const active = lesson({
      id: "cur",
      topic: "Current",
      regionId: "rCur",
      state: "TEACHING",
      slots: [slot("heading", 1), slot("flow", 2), slot("callout", 3), slot("flow", 4), slot("summary", 5)],
    });
    const other = lesson({
      id: "old",
      topic: "Old",
      regionId: "rOld",
      state: "COMPLETED",
      slots: [slot("heading", 1), slot("table", 2), slot("summary", 3)],
    });
    h.active = async () => active;
    h.lessons = async () => [other, active];

    const ctx = await buildCanvasContext("u", "c");

    expect(ctx.canvasId).toBe("c");
    expect(ctx.currentLesson).toBe(active); // reference-preserving passthrough
    expect(ctx.focusedRegionId).toBe("rCur"); // current?.regionId branch
    // active removed; only "old" remains, mapped with its coveredTypes
    expect(ctx.previousLessons).toEqual([
      { id: "old", topic: "Old", regionId: "rOld", state: "COMPLETED", coveredTypes: ["table"] },
    ]);
  });

  it("active row NOT in the list → filter removes nothing, map covers the FULL list", async () => {
    const active = lesson({ id: "ghost", topic: "Ghost", regionId: "rGhost" });
    const a = lesson({
      id: "a1",
      topic: "A",
      regionId: "rA1",
      state: "IDLE",
      slots: [slot("heading", 1), slot("chart", 2), slot("summary", 3)],
    });
    h.active = async () => active;
    h.lessons = async () => [a];

    const ctx = await buildCanvasContext("u", "c");

    expect(ctx.currentLesson).toBe(active);
    expect(ctx.focusedRegionId).toBe("rGhost");
    expect(ctx.previousLessons).toEqual([
      { id: "a1", topic: "A", regionId: "rA1", state: "IDLE", coveredTypes: ["chart"] },
    ]);
  });

  it("empty-string regionId is KEPT (?? not ||): focusedRegionId === ''", async () => {
    const active = lesson({ id: "z", regionId: "" });
    h.active = async () => active;
    h.lessons = async () => [active];

    const ctx = await buildCanvasContext("u", "c");

    expect(ctx.focusedRegionId).toBe(""); // "" ?? null === ""
    expect(ctx.previousLessons).toEqual([]); // active (id "z") filtered out of its own list
  });
});

describe("coveredTypes (via previousLessons)", () => {
  it("skips heading/summary BY TYPE regardless of position, dedupes keeping first-occurrence order", async () => {
    const l = lesson({
      id: "ord",
      topic: "Ord",
      regionId: "rOrd",
      state: "WAITING_FOR_STUDENT",
      // interleaved dups + a heading placed LAST (position 7) to prove skip is by type, not index
      slots: [
        slot("paragraph", 1),
        slot("list", 2),
        slot("paragraph", 3),
        slot("callout", 4),
        slot("list", 5),
        slot("summary", 6),
        slot("heading", 7),
      ],
    });
    h.active = async () => null;
    h.lessons = async () => [l];

    const ctx = await buildCanvasContext("u", "c");

    expect(ctx.previousLessons[0].coveredTypes).toEqual(["paragraph", "list", "callout"]);
  });

  it("slots empty array → coveredTypes is []", async () => {
    const l = lesson({ id: "empty", slots: [] });
    h.active = async () => null;
    h.lessons = async () => [l];

    const ctx = await buildCanvasContext("u", "c");

    expect(ctx.previousLessons[0].coveredTypes).toEqual([]);
  });
});
