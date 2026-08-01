import { describe, it, expect } from "vitest";
import { signUserId, verifyToken, decideTeachUser } from "@/server/auth";

// The "session expired" blocker: a first teach racing ahead of GET /api/session had no cookie → 401.
describe("decideTeachUser — dev mints inline so teaching never 401s; prod still requires a session", () => {
  it("an existing session is used as-is (never re-mints)", () => {
    expect(decideTeachUser("dev_abc", "dev")).toEqual({ userId: "dev_abc", mint: false });
    expect(decideTeachUser("clerk_123", "clerk")).toEqual({ userId: "clerk_123", mint: false });
  });
  it("DEV + no session → MINT inline (kills the race / 'session expired')", () => {
    expect(decideTeachUser(null, "dev")).toEqual({ userId: null, mint: true });
  });
  it("CLERK + no session → stays unauthenticated (real 401, prod must sign in)", () => {
    expect(decideTeachUser(null, "clerk")).toEqual({ userId: null, mint: false });
  });
});

describe("auth HMAC dev stub", () => {
  it("round-trips a signed userId", () => {
    const token = signUserId("user_123");
    expect(verifyToken(token)).toBe("user_123");
  });

  it("rejects an unsigned userId (no forging identity)", () => {
    expect(verifyToken("user_123")).toBeNull();
    expect(verifyToken("user_123.deadbeefdeadbeef")).toBeNull();
    expect(verifyToken(undefined)).toBeNull();
    expect(verifyToken(null)).toBeNull();
    expect(verifyToken("")).toBeNull();
  });

  it("rejects a tampered userId reusing another's signature", () => {
    const token = signUserId("alice");
    const sig = token.slice(token.lastIndexOf(".") + 1);
    expect(verifyToken(`bob.${sig}`)).toBeNull();
  });
});
