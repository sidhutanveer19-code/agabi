import { describe, it, expect, vi, beforeEach } from "vitest";
import { signUserId } from "@/server/auth";
import { resetRateLimit, checkRateLimit } from "@/server/rateLimit";

/**
 * POST /api/events — the batched client-event write endpoint. This suite drives the
 * REAL route through every branch of its gate chain (auth → rate-limit → schema →
 * allowlist filter → map → emit) using the REAL auth seam (HMAC-signed cookies) and
 * the REAL in-memory rate limiter — both are pure logic, not I/O (§H1.7). Only the
 * true I/O edges are faked: `@/server/db` (avoids `new PrismaClient()` at import) and
 * `emitMany` (the Postgres write), while `CLIENT_EVENT_ALLOWLIST` stays REAL so the
 * filter is exercised against production data, not a stand-in.
 */

// `emitMany` is the only external write — stub it and record what the route hands it.
const { emitManySpy } = vi.hoisted(() => ({ emitManySpy: vi.fn() }));

// db.ts does `new PrismaClient()` at module load; a bare stub keeps the import graph
// hermetic (rateLimit/events pull it in transitively but neither touches it here).
vi.mock("@/server/db", () => ({ prisma: {} }));

// Keep the REAL module (real CLIENT_EVENT_ALLOWLIST) and replace only the write.
vi.mock("@/server/events", async (importActual) => {
  const actual = await importActual<typeof import("@/server/events")>();
  return { ...actual, emitMany: emitManySpy };
});

const { POST, runtime } = await import("@/app/api/events/route");

type EventInput = { type: string; ts: number; workspaceId?: string; payload?: Record<string, unknown> };
type EmittedRow = {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  source: string;
  conversationId?: string;
};

/** A POST carrying a valid HMAC-signed identity cookie for `userId`. */
function authedReq(userId: string, body: unknown): Request {
  const cookie = `agabi_uid=${encodeURIComponent(signUserId(userId))}`;
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

/** A POST with a raw (possibly malformed) body string. */
function authedRawReq(userId: string, raw: string): Request {
  const cookie = `agabi_uid=${encodeURIComponent(signUserId(userId))}`;
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: raw,
  });
}

/** The single array of rows the route passed to emitMany. */
function emittedRows(): EmittedRow[] {
  expect(emitManySpy).toHaveBeenCalledTimes(1);
  return emitManySpy.mock.calls[0][0] as EmittedRow[];
}

beforeEach(() => {
  emitManySpy.mockReset();
  emitManySpy.mockResolvedValue([]);
  resetRateLimit();
});

describe("POST /api/events — runtime", () => {
  it("declares the nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });
});

describe("POST /api/events — auth gate", () => {
  it("401 with the exact unauthenticated envelope when no cookie is present", async () => {
    const req = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ code: "unauthenticated", message: "Sign in first.", recoverable: false });
    expect(emitManySpy).not.toHaveBeenCalled(); // gate short-circuits before the write
  });

  it("401 when the cookie signature is tampered (real HMAC rejection)", async () => {
    const forged = "attacker.not-a-valid-signature";
    const req = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `agabi_uid=${forged}` },
      body: JSON.stringify({ events: [{ type: "topic_opened", ts: 1 }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(emitManySpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/events — rate limit gate (limit is exactly 240)", () => {
  it("200: the 240th event in the window is still accepted (239 prior hits)", async () => {
    const userId = "rl-allow";
    for (let i = 0; i < 239; i++) checkRateLimit(`events:${userId}`, 240); // fill to the boundary
    const res = await POST(authedReq(userId, { events: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accepted: 0 });
  });

  it("429 with the exact rate_limited envelope once 240 hits are already used", async () => {
    const userId = "rl-block";
    for (let i = 0; i < 240; i++) checkRateLimit(`events:${userId}`, 240); // exhaust the window
    const res = await POST(authedReq(userId, { events: [{ type: "topic_opened", ts: 1 }] }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: "rate_limited", message: "Too many events.", recoverable: true });
    expect(emitManySpy).not.toHaveBeenCalled(); // blocked before the write
  });

  it("keys the limit per user — exhausting user A never blocks user B", async () => {
    for (let i = 0; i < 240; i++) checkRateLimit(`events:userA`, 240);
    const res = await POST(authedReq("userB", { events: [] }));
    expect(res.status).toBe(200); // B has a fresh window under its own key
  });
});

describe("POST /api/events — body validation gate", () => {
  it("400 with the exact bad_request envelope on malformed JSON (catch → null)", async () => {
    const res = await POST(authedRawReq("badjson", "{ this is not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "Invalid events batch.", recoverable: false });
    expect(emitManySpy).not.toHaveBeenCalled();
  });

  it("400 when `events` is not an array", async () => {
    const res = await POST(authedReq("badshape", { events: "nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("bad_request");
  });

  it("400 when an event is missing the required numeric `ts`", async () => {
    const res = await POST(authedReq("badevent", { events: [{ type: "topic_opened" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("bad_request");
    expect(emitManySpy).not.toHaveBeenCalled();
  });

  it("400 when the top-level `events` key is absent", async () => {
    const res = await POST(authedReq("noevents", { nope: [] }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/events — allowlist filter + mapping", () => {
  it("drops unknown client types and keeps only allowlisted ones", async () => {
    const events: EventInput[] = [
      { type: "topic_opened", ts: 1 }, // allowed
      { type: "arbitrary_evil_type", ts: 2 }, // dropped
      { type: "question_asked", ts: 3 }, // allowed
      { type: "server.only.spoof", ts: 4 }, // dropped (not client-allowlisted)
    ];
    const res = await POST(authedReq("u-filter", { events }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accepted: 2 });

    const rows = emittedRows();
    expect(rows.map((r) => r.type)).toEqual(["topic_opened", "question_asked"]);
  });

  it("accepts the dotted command.sent type from the allowlist", async () => {
    const res = await POST(authedReq("u-cmd", { events: [{ type: "command.sent", ts: 9 }] }));
    expect(await res.json()).toEqual({ ok: true, accepted: 1 });
    expect(emittedRows()[0].type).toBe("command.sent");
  });

  it("maps each accepted event to a client-sourced row scoped to the caller", async () => {
    const events: EventInput[] = [
      { type: "lesson_started", ts: 10, workspaceId: "ws-42", payload: { chapter: "acids" } },
    ];
    await POST(authedReq("u-map", { events }));
    const row = emittedRows()[0];
    expect(row.userId).toBe("u-map"); // scoped to the authenticated caller, never client-supplied
    expect(row.type).toBe("lesson_started");
    expect(row.payload).toEqual({ chapter: "acids" });
    expect(row.source).toBe("client"); // never trusted for billing/safety [I4]
    expect(row.conversationId).toBe("ws-42"); // conversationId := workspaceId
  });

  it("defaults a missing payload to {} and leaves conversationId undefined without a workspaceId", async () => {
    await POST(authedReq("u-default", { events: [{ type: "lesson_completed", ts: 11 }] }));
    const row = emittedRows()[0];
    expect(row.payload).toEqual({}); // e.payload ?? {}
    expect(row.conversationId).toBeUndefined();
    expect(row.source).toBe("client");
  });

  it("still emits (with an empty batch) and reports accepted:0 when every event is dropped", async () => {
    const events: EventInput[] = [
      { type: "totally_unknown", ts: 1 },
      { type: "also_unknown", ts: 2 },
    ];
    const res = await POST(authedReq("u-alldrop", { events }));
    expect(await res.json()).toEqual({ ok: true, accepted: 0 });
    expect(emittedRows()).toEqual([]); // route always calls emitMany, here with []
  });

  it("emits an empty batch and reports accepted:0 for an empty events array", async () => {
    const res = await POST(authedReq("u-empty", { events: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true, accepted: 0 });
    expect(emittedRows()).toEqual([]);
  });

  it("preserves order and count across a mixed multi-event batch", async () => {
    const events: EventInput[] = [
      { type: "topic_opened", ts: 1, workspaceId: "a" },
      { type: "nope", ts: 2 },
      { type: "lesson_started", ts: 3, workspaceId: "b" },
      { type: "question_asked", ts: 4 },
    ];
    const res = await POST(authedReq("u-multi", { events }));
    expect(await res.json()).toEqual({ ok: true, accepted: 3 });
    const rows = emittedRows();
    expect(rows.map((r) => r.type)).toEqual(["topic_opened", "lesson_started", "question_asked"]);
    expect(rows.map((r) => r.conversationId)).toEqual(["a", "b", undefined]);
    expect(rows.every((r) => r.source === "client" && r.userId === "u-multi")).toBe(true);
  });
});
