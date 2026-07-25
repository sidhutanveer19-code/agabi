import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

/**
 * Hard adversarial coverage for the auth seam's env-dependent + I/O paths that the
 * sibling auth.test.ts does not touch: getUserId (dev cookie parse + clerk dynamic
 * import), authCookieHeader (Secure branch), newAnonUserId, and readCookie edges.
 *
 * @/env is mocked with a MUTABLE hoisted object so AUTH_MODE / NODE_ENV / AUTH_SECRET
 * can be varied per test. @clerk/nextjs/server is mocked so the clerk branch runs
 * without a real request context. Nothing in auth.ts itself is mocked.
 */

const TEST_SECRET = "test-secret-key-abcdef1234567890"; // ≥16 chars

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

// Import AFTER the mocks are registered.
import {
  AUTH_COOKIE,
  signUserId,
  verifyToken,
  getUserId,
  authCookieHeader,
  newAnonUserId,
} from "@/server/auth";

/** Independently recompute the HMAC the source should produce — asserts the EXACT signature. */
function expectedSig(value: string): string {
  return crypto.createHmac("sha256", TEST_SECRET).update(value).digest("base64url");
}

function reqWithCookie(cookie: string | null): Request {
  return new Request("http://x/", cookie === null ? undefined : { headers: { cookie } });
}

beforeEach(() => {
  mockEnv.env.AUTH_SECRET = TEST_SECRET;
  mockEnv.env.AUTH_MODE = "dev";
  mockEnv.env.NODE_ENV = "test";
  clerk.auth.mockReset();
});

describe("signUserId / verifyToken — exact HMAC under a controlled secret", () => {
  it("signs with sha256/base64url — exact value, not just round-trip", () => {
    expect(signUserId("alice")).toBe(`alice.${expectedSig("alice")}`);
  });

  it("a signature minted under a DIFFERENT secret is rejected", () => {
    const foreign = crypto.createHmac("sha256", "some-other-secret-000000").update("alice").digest("base64url");
    expect(verifyToken(`alice.${foreign}`)).toBeNull();
  });

  it("rejects a token that is only a bare dot (empty userId)", () => {
    // dot === 0 → dot <= 0 → null (no empty-string identity)
    expect(verifyToken(".anything")).toBeNull();
  });

  it("rejects a token whose signature length differs (length guard, no throw)", () => {
    expect(verifyToken("alice.short")).toBeNull();
  });

  it("verifies a userId that itself contains dots (splits on the LAST dot)", () => {
    const uid = "org.team.bob";
    expect(verifyToken(signUserId(uid))).toBe(uid);
  });
});

describe("getUserId — dev cookie path (real readCookie + verifyToken)", () => {
  it("returns the userId from a valid signed cookie", async () => {
    const token = signUserId("alice");
    await expect(getUserId(reqWithCookie(`${AUTH_COOKIE}=${encodeURIComponent(token)}`))).resolves.toBe("alice");
  });

  it("picks our cookie out of many, ignoring order and stray '=' in other values", async () => {
    const token = signUserId("carol");
    const header = `sid=abc; other=x=y=z; ${AUTH_COOKIE}=${encodeURIComponent(token)}; tail=1`;
    await expect(getUserId(reqWithCookie(header))).resolves.toBe("carol");
  });

  it("returns null when there is no Cookie header at all", async () => {
    await expect(getUserId(reqWithCookie(null))).resolves.toBeNull();
  });

  it("returns null when our cookie is absent among others", async () => {
    await expect(getUserId(reqWithCookie("sid=abc; foo=bar"))).resolves.toBeNull();
  });

  it("returns null for a forged (unsigned) cookie value", async () => {
    await expect(getUserId(reqWithCookie(`${AUTH_COOKIE}=mallory`))).resolves.toBeNull();
  });

  it("skips malformed cookie segments that have no '=' ", async () => {
    const token = signUserId("dave");
    await expect(getUserId(reqWithCookie(`novalue; ${AUTH_COOKIE}=${encodeURIComponent(token)}`))).resolves.toBe("dave");
  });

  it("does NOT consult clerk in dev mode", async () => {
    await getUserId(reqWithCookie(`${AUTH_COOKIE}=${encodeURIComponent(signUserId("z"))}`));
    expect(clerk.auth).not.toHaveBeenCalled();
  });
});

describe("getUserId — clerk path (dynamic import)", () => {
  it("returns Clerk's userId when a session exists", async () => {
    mockEnv.env.AUTH_MODE = "clerk";
    clerk.auth.mockResolvedValue({ userId: "user_clerk_42" });
    await expect(getUserId(reqWithCookie(null))).resolves.toBe("user_clerk_42");
    expect(clerk.auth).toHaveBeenCalledTimes(1);
  });

  it("returns null (not undefined) when Clerk has no session — the ?? null branch", async () => {
    mockEnv.env.AUTH_MODE = "clerk";
    clerk.auth.mockResolvedValue({ userId: undefined });
    const result = await getUserId(reqWithCookie(null));
    expect(result).toBeNull();
  });

  it("ignores the signed cookie entirely in clerk mode (Clerk is the only source)", async () => {
    mockEnv.env.AUTH_MODE = "clerk";
    clerk.auth.mockResolvedValue({ userId: null });
    // A perfectly valid dev cookie is present, but clerk mode must NOT honour it.
    await expect(
      getUserId(reqWithCookie(`${AUTH_COOKIE}=${encodeURIComponent(signUserId("alice"))}`)),
    ).resolves.toBeNull();
  });
});

describe("authCookieHeader — exact Set-Cookie serialization + Secure branch", () => {
  it("omits Secure outside production (dev/test)", () => {
    mockEnv.env.NODE_ENV = "test";
    const value = encodeURIComponent(signUserId("alice"));
    expect(authCookieHeader("alice")).toBe(
      `${AUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
    );
  });

  it("adds Secure in production", () => {
    mockEnv.env.NODE_ENV = "production";
    const value = encodeURIComponent(signUserId("alice"));
    expect(authCookieHeader("alice")).toBe(
      `${AUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=31536000`,
    );
  });

  it("url-encodes the signed value so the '.' separator survives the header round-trip", async () => {
    mockEnv.env.NODE_ENV = "test";
    const header = authCookieHeader("erin");
    // Feed the emitted cookie straight back through getUserId → must resolve to the same user.
    const cookiePair = header.split(";")[0]; // agabi_uid=<value>
    await expect(getUserId(reqWithCookie(cookiePair))).resolves.toBe("erin");
  });
});

describe("newAnonUserId", () => {
  it("is a dev_ prefixed base64url id of exactly 16 chars (dev_ + 12)", () => {
    const id = newAnonUserId();
    expect(id).toMatch(/^dev_[A-Za-z0-9_-]{12}$/);
    expect(id).toHaveLength(16);
  });

  it("mints a distinct id every call", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newAnonUserId()));
    expect(ids.size).toBe(50);
  });
});
