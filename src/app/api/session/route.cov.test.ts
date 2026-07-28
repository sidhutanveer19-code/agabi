import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GET /api/session — student identity + session-cookie bootstrap. This suite drives
 * the REAL route through EVERY branch of its identity/mint/csrf logic using the REAL
 * auth seam (real getUserId cookie parsing, real signUserId/authCookieHeader/
 * newAnonUserId — all pure logic, §H1.7). Only the two true config/I-O edges are faked:
 *   • `@/env`  — a MUTABLE hoisted object so AUTH_MODE can be flipped dev↔clerk per test.
 *   • `@clerk/nextjs/server` — so getUserId's clerk path runs with no request context.
 * Nothing in route.ts or auth.ts is mocked; the whole request→response→Set-Cookie path
 * is exercised for real, exactly as the auth.getUserId suite does.
 */

const TEST_SECRET = "test-secret-key-abcdef1234567890"; // ≥16 chars (env schema min)

const mockEnv = vi.hoisted(() => ({
  env: {
    AUTH_SECRET: "test-secret-key-abcdef1234567890",
    AUTH_MODE: "dev" as string,
    NODE_ENV: "test" as string,
  },
}));
vi.mock("@/env", () => mockEnv);

const clerk = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: clerk.auth }));

// Imported AFTER the mocks register (vi.mock is hoisted). Real auth module — not mocked.
import { AUTH_COOKIE, signUserId, verifyToken, authCookieHeader } from "@/server/auth";

const { GET, runtime } = await import("@/app/api/session/route");

// ── helpers ────────────────────────────────────────────────────────────────
function reqWithCookie(cookie: string | null): Request {
  return new Request(
    "http://localhost/api/session",
    cookie === null ? undefined : { headers: { cookie } },
  );
}
/** A request carrying a VALID HMAC-signed identity cookie for `userId`. */
function signedReq(userId: string): Request {
  return reqWithCookie(`${AUTH_COOKIE}=${encodeURIComponent(signUserId(userId))}`);
}
function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}
function findCookie(res: Response, name: string): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

beforeEach(() => {
  mockEnv.env.AUTH_SECRET = TEST_SECRET;
  mockEnv.env.AUTH_MODE = "dev";
  mockEnv.env.NODE_ENV = "test";
  clerk.auth.mockReset();
});

describe("GET /api/session — module surface", () => {
  it("declares the nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("exports GET as a function", () => {
    expect(typeof GET).toBe("function");
  });
});

describe("GET /api/session — authenticated dev caller (userId already resolved)", () => {
  it("returns the resolved student and sets ONLY the csrf cookie (no re-mint)", async () => {
    const res = await GET(signedReq("alice"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ student: { id: "alice" }, preferences: {} });

    // Not minted → no agabi_uid; exactly one Set-Cookie, the csrf double-submit cookie.
    expect(findCookie(res, AUTH_COOKIE)).toBeUndefined();
    expect(setCookies(res)).toEqual(["csrf=alice; Path=/; SameSite=Lax"]);
    expect(clerk.auth).not.toHaveBeenCalled(); // dev mode never consults clerk
  });

  it("truncates the csrf token to the first 20 chars of the userId", async () => {
    const userId = "abcdefghijklmnopqrstuvwxyz0123"; // 30 chars
    const res = await GET(signedReq(userId));

    expect((await res.json()).student.id).toBe(userId); // full id in the body…
    // …but csrf carries only userId.slice(0,20).
    expect(findCookie(res, "csrf")).toBe("csrf=abcdefghijklmnopqrst; Path=/; SameSite=Lax");
  });

  it("url-encodes the csrf token (special chars in the first 20 chars)", async () => {
    const userId = "hello world@example#1"; // first 20 = "hello world@example#"
    const first20 = userId.slice(0, 20);
    const res = await GET(signedReq(userId));

    expect(findCookie(res, "csrf")).toBe(
      `csrf=${encodeURIComponent(first20)}; Path=/; SameSite=Lax`,
    );
    // The encoding is load-bearing: the raw slice differs from the encoded value.
    expect(encodeURIComponent(first20)).not.toBe(first20);
  });
});

describe("GET /api/session — dev first visit (no session → mint anon identity)", () => {
  it("mints a signed anon cookie + csrf and returns the fresh student id", async () => {
    const res = await GET(reqWithCookie(null));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json();
    const id: string = body.student.id;
    expect(id).toMatch(/^dev_[A-Za-z0-9_-]{12}$/); // real newAnonUserId shape
    expect(body.preferences).toEqual({});

    // TWO Set-Cookies: the minted auth cookie, then csrf.
    expect(setCookies(res)).toHaveLength(2);

    // The auth cookie is byte-identical to the real serializer for this id…
    const authCookie = findCookie(res, AUTH_COOKIE);
    expect(authCookie).toBe(authCookieHeader(id));
    // …and its signed value verifies back to the same id (a real, forge-proof identity).
    const value = decodeURIComponent(authCookie!.split(";")[0].slice(`${AUTH_COOKIE}=`.length));
    expect(verifyToken(value)).toBe(id);

    // csrf mirrors the (≤20-char) id; base64url needs no percent-encoding.
    expect(findCookie(res, "csrf")).toBe(`csrf=${id}; Path=/; SameSite=Lax`);
    expect(clerk.auth).not.toHaveBeenCalled();
  });

  it("the freshly minted cookie is a valid identity on the next request (no re-mint)", async () => {
    const first = await GET(reqWithCookie(null));
    const id: string = (await first.json()).student.id;
    const authPair = findCookie(first, AUTH_COOKIE)!.split(";")[0]; // agabi_uid=<value>

    const second = await GET(reqWithCookie(authPair));
    expect((await second.json()).student.id).toBe(id); // same student, resolved from the cookie
    expect(findCookie(second, AUTH_COOKIE)).toBeUndefined(); // already authed → not re-minted
    expect(setCookies(second)).toEqual([`csrf=${id}; Path=/; SameSite=Lax`]);
  });
});

describe("GET /api/session — clerk mode, signed OUT (no session)", () => {
  it("returns a null student with NO cookies when clerk has no session (userId undefined)", async () => {
    mockEnv.env.AUTH_MODE = "clerk";
    clerk.auth.mockResolvedValue({ userId: undefined });

    const res = await GET(reqWithCookie(null));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ student: null, preferences: {} });

    // Early return fires BEFORE any mint and BEFORE the csrf append → zero Set-Cookies.
    expect(setCookies(res)).toEqual([]);
    expect(clerk.auth).toHaveBeenCalledTimes(1);
  });

  it("also returns null student when clerk yields userId: null (the ?? branch)", async () => {
    mockEnv.env.AUTH_MODE = "clerk";
    clerk.auth.mockResolvedValue({ userId: null });

    const res = await GET(reqWithCookie(null));
    expect(await res.json()).toEqual({ student: null, preferences: {} });
    expect(setCookies(res)).toEqual([]);
  });

  it("ignores a valid dev cookie in clerk mode — identity comes only from clerk", async () => {
    mockEnv.env.AUTH_MODE = "clerk";
    clerk.auth.mockResolvedValue({ userId: null });

    // A perfectly valid signed dev cookie is present, but clerk mode must not honour it.
    const res = await GET(signedReq("alice"));
    expect(await res.json()).toEqual({ student: null, preferences: {} });
    expect(setCookies(res)).toEqual([]); // no mint, no csrf — never falls through to dev logic
  });
});

describe("GET /api/session — clerk mode, signed IN (active session)", () => {
  it("returns clerk's student and sets ONLY csrf (never mints an anon cookie)", async () => {
    mockEnv.env.AUTH_MODE = "clerk";
    clerk.auth.mockResolvedValue({ userId: "user_clerk_42" });

    const res = await GET(reqWithCookie(null));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ student: { id: "user_clerk_42" }, preferences: {} });

    // Authenticated via clerk → skips the mint branch entirely; only csrf is set.
    expect(findCookie(res, AUTH_COOKIE)).toBeUndefined();
    expect(setCookies(res)).toEqual(["csrf=user_clerk_42; Path=/; SameSite=Lax"]);
    expect(clerk.auth).toHaveBeenCalledTimes(1);
  });
});
