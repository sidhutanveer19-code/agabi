import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TeachIO } from "@/server/conversation/manager";

/**
 * Hard adversarial coverage for the `/api/canvas/[canvasId]/teach` POST adapter.
 * The route is a thin HTTP shell, but every guard and the streaming lifecycle are
 * real logic worth pinning: the mint-vs-existing identity split, the 401/400/429/400
 * error ladder (order matters — canvasId before rate-limit before body-parse), the
 * `v:1` stamping of every stream event, the run-threw error+done fallback (Error vs
 * non-Error message), fire-and-forget outbox drain that must never block teaching,
 * and the cancel()→abort + close-after-close defensive catches.
 *
 * WHAT IS FAKED — ONLY the true I/O edges (§H1.7): `getUserId` (cookie/clerk network
 * seam), the conversation `run` (providers + DB + streaming), `drainOutbox` (DB),
 * `@/server/db` (so no PrismaClient is constructed), and `@/env` (config, via a
 * MUTABLE hoisted object so AUTH_MODE / RATE_LIMIT_PER_MIN vary per test).
 * WHAT IS REAL — `decideTeachUser`, `newAnonUserId`, `authCookieHeader` (the whole
 * mint path), the in-memory `checkRateLimit`, and the real zod `teachBodySchema`.
 */

const TEST_SECRET = "test-secret-key-abcdef1234567890"; // ≥16 chars

const mockEnv = vi.hoisted(() => ({
  env: {
    AUTH_SECRET: "test-secret-key-abcdef1234567890",
    AUTH_MODE: "dev" as string,
    NODE_ENV: "test" as string,
    RATE_LIMIT_PER_MIN: 100 as number,
  },
}));
vi.mock("@/env", () => mockEnv);

// No PrismaClient — rateLimit imports `prisma` at module scope but the in-memory limiter never uses it.
vi.mock("@/server/db", () => ({ prisma: {} }));

// The two true external-I/O collaborators the route calls.
const mocks = vi.hoisted(() => ({ run: vi.fn(), drainOutbox: vi.fn() }));
vi.mock("@/server/conversation/manager", () => ({ run: mocks.run }));
vi.mock("@/server/evidence/outbox", () => ({ drainOutbox: mocks.drainOutbox }));

// Keep ALL of auth real except the identity I/O seam getUserId.
const authMock = vi.hoisted(() => ({ getUserId: vi.fn() }));
vi.mock("@/server/auth", async (io: () => Promise<typeof import("@/server/auth")>) => ({
  ...(await io()),
  getUserId: authMock.getUserId,
}));

// Import AFTER the mocks are registered.
import { POST } from "@/app/api/canvas/[canvasId]/teach/route";
import { authCookieHeader } from "@/server/auth";
import { resetRateLimit } from "@/server/rateLimit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_BODY = {
  request: { kind: "lesson", topic: "Photosynthesis" },
  context: { topic: "Photosynthesis", explanations: [], selectedRegionId: null },
} as const;

type RunArgs = { request: unknown; context: unknown; userId: string; canvasId: string; io: TeachIO };
let captured: RunArgs | null = null;

function makeReq(body?: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/canvas/c1/teach", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctx = (canvasId: string) => ({ params: Promise.resolve({ canvasId }) });

beforeEach(() => {
  mockEnv.env.AUTH_MODE = "dev";
  mockEnv.env.NODE_ENV = "test";
  mockEnv.env.AUTH_SECRET = TEST_SECRET;
  mockEnv.env.RATE_LIMIT_PER_MIN = 100;
  captured = null;
  resetRateLimit();
  authMock.getUserId.mockReset();
  authMock.getUserId.mockResolvedValue(null); // default: no session
  mocks.drainOutbox.mockReset();
  mocks.drainOutbox.mockResolvedValue({ drained: 0, remaining: 0 });
  mocks.run.mockReset();
  // Default run: capture what the route handed it, emit nothing, resolve cleanly.
  mocks.run.mockImplementation(
    async (request: unknown, context: unknown, userId: string, canvasId: string, io: TeachIO) => {
      captured = { request, context, userId, canvasId, io };
    },
  );
});

// ── Identity: dev mint path ────────────────────────────────────────────────
describe("dev mode with no session → mints an anon user and streams", () => {
  it("passes the parsed body, minted userId and canvasId to run; stamps v:1 on events", async () => {
    mocks.run.mockImplementation(
      async (request: unknown, context: unknown, userId: string, canvasId: string, io: TeachIO) => {
        captured = { request, context, userId, canvasId, io };
        io.write({ t: "status", status: "thinking" });
        io.write({ t: "region", title: "Photosynthesis" });
      },
    );

    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    // Every event newline-delimited and stamped v:1 FIRST.
    expect(text).toBe(
      '{"v":1,"t":"status","status":"thinking"}\n{"v":1,"t":"region","title":"Photosynthesis"}\n',
    );

    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(captured).not.toBeNull();
    expect(captured!.request).toEqual(VALID_BODY.request);
    expect(captured!.context).toEqual(VALID_BODY.context);
    expect(captured!.canvasId).toBe("c1");
    expect(captured!.userId).toMatch(/^dev_[A-Za-z0-9_-]{12}$/); // freshly minted
  });

  it("appends exactly the Set-Cookie for the minted user (real authCookieHeader)", async () => {
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    await res.text();
    expect(res.headers.getSetCookie()).toEqual([authCookieHeader(captured!.userId)]);
  });

  it("reqId is a UUID, identical on the header and in run's TeachIO", async () => {
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    await res.text();
    const headerId = res.headers.get("x-agabi-req-id");
    expect(headerId).toMatch(UUID_RE);
    expect(captured!.io.reqId).toBe(headerId);
    expect(captured!.io.signal).toBeInstanceOf(AbortSignal);
    expect(captured!.io.signal.aborted).toBe(false);
  });

  it("drains the outbox once, fire-and-forget with no arguments", async () => {
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    await res.text();
    expect(mocks.drainOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.drainOutbox.mock.calls[0]).toEqual([]);
  });
});

// ── Identity: existing session (no mint) ───────────────────────────────────
describe("existing session → no mint, no Set-Cookie", () => {
  it("uses the resolved userId verbatim and never appends a cookie", async () => {
    authMock.getUserId.mockResolvedValue("u1");
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    await res.text();
    expect(captured!.userId).toBe("u1");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("clerk mode WITH a session teaches (existingUserId short-circuits the mode check)", async () => {
    mockEnv.env.AUTH_MODE = "clerk";
    authMock.getUserId.mockResolvedValue("clerk_user_9");
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    await res.text();
    expect(res.status).toBe(200);
    expect(captured!.userId).toBe("clerk_user_9");
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

// ── 401: clerk mode, no session ────────────────────────────────────────────
describe("clerk mode with no session → 401 unauthenticated", () => {
  it("returns the exact JSON error and never invokes run or drainOutbox", async () => {
    mockEnv.env.AUTH_MODE = "clerk";
    authMock.getUserId.mockResolvedValue(null);
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      code: "unauthenticated",
      message: "Sign in first.",
      recoverable: false,
    });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.drainOutbox).not.toHaveBeenCalled();
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

// ── 400: missing / blank canvasId (checked BEFORE rate-limit and body) ──────
describe("missing or blank canvasId → 400 bad_request", () => {
  it("empty string is a 400, not a fallback, and run is never called", async () => {
    const res = await POST(makeReq(VALID_BODY), ctx(""));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Missing canvasId.",
      recoverable: false,
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("a whitespace-only canvasId trips the .trim() guard (truthy string, empty trimmed)", async () => {
    const res = await POST(makeReq(VALID_BODY), ctx("   "));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Missing canvasId.");
  });

  it("does not append the minted Set-Cookie on the 400 error response", async () => {
    const res = await POST(makeReq(VALID_BODY), ctx(""));
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

// ── 429: rate limited (real in-memory limiter, stable userId) ──────────────
describe("rate limit exceeded → 429 recoverable", () => {
  it("the call past the per-minute limit returns the exact 429 and skips run", async () => {
    mockEnv.env.RATE_LIMIT_PER_MIN = 1;
    authMock.getUserId.mockResolvedValue("rluser"); // stable key `teach:rluser`

    const first = await POST(makeReq(VALID_BODY), ctx("c1")); // consumes the only token
    await first.text();
    expect(first.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledTimes(1);

    const second = await POST(makeReq(VALID_BODY), ctx("c1")); // over the limit
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({
      code: "rate_limited",
      message: "Too many lessons this minute — take a breath.",
      recoverable: true,
    });
    expect(mocks.run).toHaveBeenCalledTimes(1); // NOT called again
  });
});

// ── 400: body parse (checked AFTER canvasId + rate-limit) ──────────────────
describe("invalid teach body → 400 bad_request", () => {
  it("malformed JSON is caught (req.json throws → null) and rejected", async () => {
    authMock.getUserId.mockResolvedValue("u1");
    const res = await POST(makeReq("{not valid json"), ctx("c1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Invalid teach request.",
      recoverable: false,
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("a JSON body that fails the schema is rejected", async () => {
    authMock.getUserId.mockResolvedValue("u1");
    const res = await POST(makeReq({ request: { kind: "nope" }, context: {} }), ctx("c1"));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Invalid teach request.");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("an empty POST body (no JSON at all) is rejected", async () => {
    authMock.getUserId.mockResolvedValue("u1");
    const res = await POST(makeReq(undefined), ctx("c1"));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Invalid teach request.");
  });
});

// ── Streaming error handling ───────────────────────────────────────────────
describe("run() throws → error + done events, stream still 200", () => {
  it("an Error surfaces its message on a recoverable error event, then done", async () => {
    mocks.run.mockImplementation(async () => {
      throw new Error("boom");
    });
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    const text = await res.text();
    expect(res.status).toBe(200); // headers already flushed; failure rides the stream
    expect(text).toBe(
      '{"v":1,"t":"error","recoverable":true,"message":"boom"}\n{"v":1,"t":"done"}\n',
    );
  });

  it("a non-Error throw falls back to the generic message", async () => {
    mocks.run.mockImplementation(async () => {
      throw "kaboom"; // not an Error instance → e instanceof Error === false
    });
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    const text = await res.text();
    expect(text).toBe(
      '{"v":1,"t":"error","recoverable":true,"message":"The teacher hit a snag."}\n{"v":1,"t":"done"}\n',
    );
  });

  it("events emitted before the throw are preserved, then error + done appended", async () => {
    mocks.run.mockImplementation(async (_r: unknown, _c: unknown, _u: string, _cid: string, io: TeachIO) => {
      io.write({ t: "status", status: "generating" });
      throw new Error("late failure");
    });
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    const text = await res.text();
    expect(text).toBe(
      '{"v":1,"t":"status","status":"generating"}\n' +
        '{"v":1,"t":"error","recoverable":true,"message":"late failure"}\n' +
        '{"v":1,"t":"done"}\n',
    );
  });
});

// ── Outbox failure must never block teaching ───────────────────────────────
describe("drainOutbox rejection is swallowed", () => {
  it("a rejected drainOutbox does not break the stream (opportunistic, non-blocking)", async () => {
    mocks.drainOutbox.mockRejectedValue(new Error("db down"));
    mocks.run.mockImplementation(async (_r: unknown, _c: unknown, _u: string, _cid: string, io: TeachIO) => {
      io.write({ t: "done" });
    });
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toBe('{"v":1,"t":"done"}\n');
    expect(mocks.drainOutbox).toHaveBeenCalledTimes(1);
  });
});

// ── write() after the controller closes must not throw ─────────────────────
describe("write() guards against a closed controller", () => {
  it("calling the captured write after the stream is drained is a silent no-op", async () => {
    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    await res.text(); // drains + closes the controller
    // The write closure still references the (now-closed) controller; enqueue throws, is caught.
    expect(() => captured!.io.write({ t: "status", status: "idle" })).not.toThrow();
  });
});

// ── cancel() aborts the signal + the finally close() double-close is caught ─
describe("client disconnect → cancel() aborts run's signal", () => {
  it("cancelling the response body aborts the AbortSignal handed to run", async () => {
    // run stays in-flight until the abort fires, so cancel() reaches a live controller.
    mocks.run.mockImplementation(
      (_r: unknown, _c: unknown, _u: string, _cid: string, io: TeachIO) =>
        new Promise<void>((resolve) => {
          captured = { request: _r, context: _c, userId: _u, canvasId: _cid, io };
          io.signal.addEventListener("abort", () => resolve());
        }),
    );

    const res = await POST(makeReq(VALID_BODY), ctx("c1"));
    expect(captured!.io.signal.aborted).toBe(false);

    await res.body!.cancel(); // → stream cancel() → ac.abort() → run resolves → finally close() (already closed, caught)

    expect(captured!.io.signal.aborted).toBe(true);
  });
});
