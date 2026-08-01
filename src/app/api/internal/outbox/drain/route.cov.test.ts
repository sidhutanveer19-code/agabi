import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/internal/outbox/drain — the cron-callable evidence-recovery backstop.
 * The route is a thin shell but every guard is load-bearing: the shared-secret
 * header gate (constant-string `!==` compare — both sides), the exact 403 envelope,
 * the delegation to drainOutbox with the EXACT limit 200, and the 200 response's
 * body/headers (JSON.stringify of the drain result + cache-control: no-store).
 *
 * WHAT IS FAKED — ONLY the true I/O edges (§H1.7): `drainOutbox` (it hits Postgres)
 * and `@/env` (config, via a MUTABLE hoisted object so AUTH_SECRET is a known value).
 * Nothing in route.ts is mocked; the whole Request → secret check → Response path
 * runs for real. `drainOutbox` returns a distinctive object so we can prove the body
 * is its serialization, not a stand-in.
 */

const SECRET = "cron-secret-key-abcdef1234567890"; // ≥16 chars (env schema min)

const mockEnv = vi.hoisted(() => ({
  env: { AUTH_SECRET: "cron-secret-key-abcdef1234567890" },
}));
vi.mock("@/env", () => mockEnv);

// drainOutbox is the ONLY external write (Postgres) — stub it, record its arg + control its return.
const mocks = vi.hoisted(() => ({ drainOutbox: vi.fn() }));
vi.mock("@/server/evidence/outbox", () => ({ drainOutbox: mocks.drainOutbox }));

const { POST, runtime, dynamic } = await import("@/app/api/internal/outbox/drain/route");

const HEADER = "x-agabi-cron-secret";

/** A POST carrying the given cron-secret header value (omit to send no header). */
function req(secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers[HEADER] = secret;
  return new Request("http://localhost/api/internal/outbox/drain", { method: "POST", headers });
}

beforeEach(() => {
  mocks.drainOutbox.mockReset();
  mocks.drainOutbox.mockResolvedValue({ drained: 0, remaining: 0 });
  mockEnv.env.AUTH_SECRET = SECRET;
});

describe("POST /api/internal/outbox/drain — route module", () => {
  it("declares the nodejs runtime and force-dynamic (never statically cached)", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });
});

describe("POST /api/internal/outbox/drain — secret gate (forbidden side)", () => {
  it("403 with the exact forbidden envelope when NO secret header is present", async () => {
    const res = await POST(req()); // null !== secret
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ code: "forbidden" });
    expect(mocks.drainOutbox).not.toHaveBeenCalled(); // gate short-circuits before the drain
  });

  it("403 when the secret header is present but WRONG", async () => {
    const res = await POST(req("not-the-secret"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "forbidden" });
    expect(mocks.drainOutbox).not.toHaveBeenCalled();
  });

  it("403 on an empty-string header (empty !== secret, boundary)", async () => {
    const res = await POST(req(""));
    expect(res.status).toBe(403);
    expect(mocks.drainOutbox).not.toHaveBeenCalled();
  });

  it("403 is case-sensitive on the VALUE — a differently-cased secret is rejected", async () => {
    const res = await POST(req(SECRET.toUpperCase()));
    expect(res.status).toBe(403);
    expect(mocks.drainOutbox).not.toHaveBeenCalled();
  });

  it("the 403 response carries no cache-control header (only the 200 path sets no-store)", async () => {
    const res = await POST(req("wrong"));
    expect(res.headers.get("cache-control")).toBeNull();
  });
});

describe("POST /api/internal/outbox/drain — authorized drain (200 side)", () => {
  it("200 delegates to drainOutbox with EXACTLY 200 and serializes its result as the body", async () => {
    mocks.drainOutbox.mockResolvedValue({ drained: 5, remaining: 2 });
    const res = await POST(req(SECRET));

    expect(res.status).toBe(200);
    expect(mocks.drainOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.drainOutbox).toHaveBeenCalledWith(200); // the drain batch cap, exact
    expect(await res.json()).toEqual({ drained: 5, remaining: 2 }); // body IS the drain result
  });

  it("200 sets content-type json AND cache-control: no-store", async () => {
    const res = await POST(req(SECRET));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("forwards the drain's -1 fallbacks verbatim (query/count failure surfaced, not masked)", async () => {
    mocks.drainOutbox.mockResolvedValue({ drained: 0, remaining: -1 });
    const res = await POST(req(SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ drained: 0, remaining: -1 });
  });

  it("passes when env.AUTH_SECRET is rotated at runtime and the header matches the new value", async () => {
    mockEnv.env.AUTH_SECRET = "rotated-secret-key-0987654321zz";
    mocks.drainOutbox.mockResolvedValue({ drained: 1, remaining: 0 });

    // The OLD secret is now rejected...
    expect((await POST(req(SECRET))).status).toBe(403);
    expect(mocks.drainOutbox).not.toHaveBeenCalled();

    // ...and the NEW secret is accepted (proves the compare reads env, not a captured constant).
    const ok = await POST(req("rotated-secret-key-0987654321zz"));
    expect(ok.status).toBe(200);
    expect(mocks.drainOutbox).toHaveBeenCalledWith(200);
    expect(await ok.json()).toEqual({ drained: 1, remaining: 0 });
  });
});
