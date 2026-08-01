import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import type { ShadowDiff } from "@/server/evaluation/shadowPlanner";

/**
 * shadowPlanner — the Evaluation-world shadow-planning stub.
 *
 * The module has exactly one I/O edge: `process.env.SHADOW_PLANNING`, read ONCE at
 * import time into the `SHADOW_ENABLED` const. Its logic is therefore two branches:
 *   1. `SHADOW_ENABLED = process.env.SHADOW_PLANNING === "1"` — a STRICT `=== "1"`
 *      comparison (not truthiness): only the exact string "1" flips it true.
 *   2. `recordShadowPlan`: `if (!SHADOW_ENABLED) return;` — early-return when off,
 *      fall-through no-op when on. It resolves `undefined` and never throws either way.
 *
 * Because the const is captured at load, every case reloads the module with
 * `vi.resetModules()` + a fresh dynamic import under a specific env value, then asserts
 * the EXACT observable: the boolean `SHADOW_ENABLED` and the `undefined` resolution.
 * Mutation targets guarded: `=== "1"` → truthiness ("0"/"2"/" 1" would flip true) and
 * `!SHADOW_ENABLED` inversion (both env states are exercised).
 */

type ShadowModule = typeof import("@/server/evaluation/shadowPlanner");

const ORIGINAL_ENV = process.env.SHADOW_PLANNING;

/** Reload the module fresh under a specific SHADOW_PLANNING value (undefined = unset). */
async function loadWith(envValue: string | undefined): Promise<ShadowModule> {
  vi.resetModules();
  if (envValue === undefined) delete process.env.SHADOW_PLANNING;
  else process.env.SHADOW_PLANNING = envValue;
  return import("@/server/evaluation/shadowPlanner");
}

/** A well-formed diff — the function ignores its arg, so this documents the no-op contract. */
const DIFF: ShadowDiff = {
  topic: "photosynthesis",
  proposed: ["heading", "text", "list"],
  chosen: ["heading", "text"],
  ms: 42,
  tokens: 1280,
};

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.SHADOW_PLANNING;
  else process.env.SHADOW_PLANNING = ORIGINAL_ENV;
});
afterAll(() => {
  vi.resetModules();
});

describe("SHADOW_ENABLED — strict `=== \"1\"` env parse", () => {
  it('env exactly "1" → true (the ONLY value that enables it)', async () => {
    const mod = await loadWith("1");
    expect(mod.SHADOW_ENABLED).toBe(true);
  });

  it("env unset (undefined) → false", async () => {
    const mod = await loadWith(undefined);
    expect(mod.SHADOW_ENABLED).toBe(false);
  });

  it('env "0" → false (not truthiness — "0" is a non-empty string but !== "1")', async () => {
    const mod = await loadWith("0");
    expect(mod.SHADOW_ENABLED).toBe(false);
  });

  it('env "" (empty string) → false', async () => {
    const mod = await loadWith("");
    expect(mod.SHADOW_ENABLED).toBe(false);
  });

  it('env " 1" (leading whitespace) → false — strict compare, no trim', async () => {
    const mod = await loadWith(" 1");
    expect(mod.SHADOW_ENABLED).toBe(false);
  });

  it('env "1 " (trailing whitespace) → false', async () => {
    const mod = await loadWith("1 ");
    expect(mod.SHADOW_ENABLED).toBe(false);
  });

  it('env "2" → false', async () => {
    const mod = await loadWith("2");
    expect(mod.SHADOW_ENABLED).toBe(false);
  });

  it('env "true" → false (only literal "1" counts)', async () => {
    const mod = await loadWith("true");
    expect(mod.SHADOW_ENABLED).toBe(false);
  });

  it('env "11" → false (not a prefix/substring match)', async () => {
    const mod = await loadWith("11");
    expect(mod.SHADOW_ENABLED).toBe(false);
  });
});

describe("recordShadowPlan — disabled branch (early return)", () => {
  it("SHADOW_ENABLED false → resolves undefined (no-op), never throws", async () => {
    const mod = await loadWith(undefined);
    expect(mod.SHADOW_ENABLED).toBe(false);
    await expect(mod.recordShadowPlan(DIFF)).resolves.toBeUndefined();
  });

  it("returns a Promise synchronously (async signature), still no-op", async () => {
    const mod = await loadWith("0");
    const p = mod.recordShadowPlan(DIFF);
    expect(p).toBeInstanceOf(Promise);
    await expect(p).resolves.toBeUndefined();
  });

  it("ignores its arg — an empty/degenerate diff still resolves undefined", async () => {
    const mod = await loadWith(undefined);
    const empty: ShadowDiff = { topic: "", proposed: [], chosen: [], ms: 0, tokens: 0 };
    await expect(mod.recordShadowPlan(empty)).resolves.toBeUndefined();
  });
});

describe("recordShadowPlan — enabled branch (fall-through no-op)", () => {
  it("SHADOW_ENABLED true → falls past the guard, still resolves undefined", async () => {
    const mod = await loadWith("1");
    expect(mod.SHADOW_ENABLED).toBe(true);
    await expect(mod.recordShadowPlan(DIFF)).resolves.toBeUndefined();
  });

  it("returns a Promise and never throws even with an adversarial diff", async () => {
    const mod = await loadWith("1");
    const hostile: ShadowDiff = {
      topic: "x".repeat(5000),
      proposed: Array.from({ length: 200 }, (_, i) => `t${i}`),
      chosen: [],
      ms: -1,
      tokens: Number.MAX_SAFE_INTEGER,
    };
    const p = mod.recordShadowPlan(hostile);
    expect(p).toBeInstanceOf(Promise);
    await expect(p).resolves.toBeUndefined();
  });
});

describe("reload isolation — the const re-reads env on every fresh import", () => {
  it("toggling env across reloads flips SHADOW_ENABLED both directions", async () => {
    const on1 = await loadWith("1");
    expect(on1.SHADOW_ENABLED).toBe(true);

    const off = await loadWith("0");
    expect(off.SHADOW_ENABLED).toBe(false);

    const on2 = await loadWith("1");
    expect(on2.SHADOW_ENABLED).toBe(true);

    // Distinct module instances across resets (each re-evaluates the top level).
    expect(on2).not.toBe(on1);
  });
});
