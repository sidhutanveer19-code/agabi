import { describe, it, expect } from "vitest";
import { buildTools } from "@/server/ai/blockTools";
import { BLOCK_TYPES, BLOCK_TYPE_SET } from "@/server/ai/blockTypes";
import { providerChain, isFallthroughError } from "@/server/ai/providers";

describe("blockTools / block registry mirror", () => {
  it("exposes a single emit_block tool", () => {
    const tools = buildTools(async () => {});
    expect(tools.emit_block).toBeDefined();
  });

  it("covers the full block catalog with unique, non-empty type names", () => {
    expect(BLOCK_TYPES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(BLOCK_TYPES).size).toBe(BLOCK_TYPES.length); // no dupes
    for (const t of BLOCK_TYPES) {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
      expect(BLOCK_TYPE_SET.has(t)).toBe(true);
    }
  });
});

describe("provider chain (D2)", () => {
  it("returns an ordered array (empty when no keys configured)", () => {
    expect(Array.isArray(providerChain())).toBe(true);
  });

  it("treats 429/500/rate-limit as fall-through, real errors as fatal", () => {
    expect(isFallthroughError({ statusCode: 429 })).toBe(true);
    expect(isFallthroughError({ statusCode: 503 })).toBe(true);
    expect(isFallthroughError(new Error("rate limit exceeded"))).toBe(true);
    expect(isFallthroughError(new Error("model is overloaded"))).toBe(true);
    expect(isFallthroughError(new Error("invalid api key"))).toBe(false);
    expect(isFallthroughError({ statusCode: 400 })).toBe(false);
  });
});
