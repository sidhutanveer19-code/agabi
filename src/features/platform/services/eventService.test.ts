import { describe, it, expect, vi, beforeEach } from "vitest";
import { ENDPOINTS, type StudentEvent } from "@contract";

/**
 * eventService.send — batches observation events to the Event Log.
 * The ONLY I/O boundary (apiClient.postJson → fetch) is stubbed; everything asserted
 * here is the module's OWN logic: the `events.length === 0` early-return branch, the
 * exact endpoint + request-body shape (`{ events }` shorthand → same array by ref),
 * that the resolved response is discarded (returns undefined), and that a rejected
 * post propagates unchanged (not swallowed, despite the "fire-and-forget" doc).
 */

// Mutable per-test behaviour, hoisted above the vi.mock factory.
const h = vi.hoisted(() => ({
  postJson: (async () => ({})) as (path: string, body: unknown) => Promise<unknown>,
}));

vi.mock("@/features/platform/client/apiClient", () => ({
  apiClient: {
    postJson: vi.fn((path: string, body: unknown) => h.postJson(path, body)),
  },
}));

const { eventService } = await import("@/features/platform/services/eventService");
const { apiClient } = await import("@/features/platform/client/apiClient");
const postJson = apiClient.postJson as unknown as ReturnType<typeof vi.fn>;

function ev(over: Partial<StudentEvent> = {}): StudentEvent {
  return { type: "topic_opened", ts: 1000, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.postJson = async () => ({});
});

describe("eventService.send — empty batch (early-return branch)", () => {
  it("empty array → resolves to undefined and NEVER calls postJson", async () => {
    const result = await eventService.send([]);
    expect(result).toBeUndefined();
    expect(postJson).not.toHaveBeenCalled();
  });
});

describe("eventService.send — non-empty batch (post branch)", () => {
  it("one event → POSTs to /api/events with { events:[e] } exactly, resolves undefined", async () => {
    const e = ev({ type: "lesson_started", ts: 42, workspaceId: "w1", payload: { a: 1 } });

    const result = await eventService.send([e]);

    expect(result).toBeUndefined();
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith("/api/events", { events: [e] });
    // path is exactly the contract's source-of-truth endpoint
    expect(postJson.mock.calls[0][0]).toBe(ENDPOINTS.events.path);
    expect(ENDPOINTS.events.path).toBe("/api/events");
  });

  it("multiple events → forwarded in order in ONE batched call", async () => {
    const a = ev({ type: "pan", ts: 1 });
    const b = ev({ type: "zoom", ts: 2 });
    const c = ev({ type: "question", ts: 3, payload: { q: "why" } });

    await eventService.send([a, b, c]);

    expect(postJson).toHaveBeenCalledTimes(1);
    const [path, body] = postJson.mock.calls[0] as [string, { events: StudentEvent[] }];
    expect(path).toBe("/api/events");
    expect(body).toEqual({ events: [a, b, c] });
  });

  it("wraps the caller's array by reference under `events` (no copy/mutation)", async () => {
    const arr = [ev({ type: "selection", ts: 5 })];

    await eventService.send(arr);

    const body = postJson.mock.calls[0][1] as { events: StudentEvent[] };
    expect(body.events).toBe(arr); // exact same reference — the `{ events }` shorthand
  });

  it("discards postJson's resolved value → send still resolves to undefined", async () => {
    h.postJson = async () => ({ ok: true, id: 99 });

    const result = await eventService.send([ev()]);

    expect(result).toBeUndefined();
  });
});

describe("eventService.send — failure propagation", () => {
  it("postJson rejects → send rejects with the SAME error (not swallowed)", async () => {
    const boom = new Error("network down");
    h.postJson = async () => {
      throw boom;
    };

    await expect(eventService.send([ev()])).rejects.toBe(boom);
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it("empty batch never reaches postJson even when it would reject", async () => {
    h.postJson = async () => {
      throw new Error("should never be called");
    };

    await expect(eventService.send([])).resolves.toBeUndefined();
    expect(postJson).not.toHaveBeenCalled();
  });
});
