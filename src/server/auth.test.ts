import { describe, it, expect } from "vitest";
import { signUserId, verifyToken } from "@/server/auth";

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
