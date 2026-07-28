import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * config/devMode — the single authoring gate, derived from process.env AT IMPORT
 * TIME. The ONLY I/O edge is the environment (`process.env.NEXT_PUBLIC_AGABI_DEV`);
 * it is the thing faked here. Nothing else is stubbed — the real expressions run:
 *   DEV_MODE       = process.env.NEXT_PUBLIC_AGABI_DEV === "1"
 *   useDevMode()   = () => DEV_MODE
 *
 * Because DEV_MODE is computed once at module top-level, each case sets the env,
 * `vi.resetModules()`, then dynamically re-imports so the top-level code
 * re-evaluates against that env. Every assertion names the EXACT expected value.
 *
 * Branches under test:
 *   - strict `=== "1"`: the literal "1" is the ONLY truthy input (true side)
 *   - false side: unset/undefined key, "0", "true", "", "1 "/" 1" (no trim),
 *     "01" (not the bare literal), and the number-ish env is always a STRING
 *   - useDevMode() returns the SAME boolean as DEV_MODE in both the on and off
 *     builds (it is a pass-through hook, not an independent read)
 */

type DevModeModule = typeof import("@/config/devMode");

const ENV_KEY = "NEXT_PUBLIC_AGABI_DEV" as const;

let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
  vi.resetModules();
});

/**
 * Fully control the env key (undefined ⇒ the key is DELETED so the top-level
 * `process.env.NEXT_PUBLIC_AGABI_DEV` reads `undefined`, exercising the false
 * side of `=== "1"`), reset the module cache, then re-import so DEV_MODE and the
 * hook recompute against this env.
 */
async function loadDevMode(value: string | undefined): Promise<DevModeModule> {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  vi.resetModules();
  return import("@/config/devMode");
}

describe("devMode — DEV_MODE (strict === '1')", () => {
  it("env === '1' → DEV_MODE is exactly true (the one enabling value)", async () => {
    const { DEV_MODE } = await loadDevMode("1");
    expect(DEV_MODE).toBe(true);
  });

  it("env unset (key deleted → undefined) → DEV_MODE is exactly false", async () => {
    const { DEV_MODE } = await loadDevMode(undefined);
    expect(DEV_MODE).toBe(false);
  });

  it("env === '0' → false (strict, not merely 'non-1-is-off' via coercion)", async () => {
    const { DEV_MODE } = await loadDevMode("0");
    expect(DEV_MODE).toBe(false);
  });

  it("env === 'true' → false (only the literal '1' enables it, not other truthy words)", async () => {
    const { DEV_MODE } = await loadDevMode("true");
    expect(DEV_MODE).toBe(false);
  });

  it("env === '' (empty string) → false", async () => {
    const { DEV_MODE } = await loadDevMode("");
    expect(DEV_MODE).toBe(false);
  });

  it("env === '1 ' (trailing space) → false (strict equality, no trim)", async () => {
    const { DEV_MODE } = await loadDevMode("1 ");
    expect(DEV_MODE).toBe(false);
  });

  it("env === ' 1' (leading space) → false (strict equality, no trim)", async () => {
    const { DEV_MODE } = await loadDevMode(" 1");
    expect(DEV_MODE).toBe(false);
  });

  it("env === '01' → false (not the bare literal '1')", async () => {
    const { DEV_MODE } = await loadDevMode("01");
    expect(DEV_MODE).toBe(false);
  });

  it("DEV_MODE is always a boolean primitive (=== yields a real boolean, on or off)", async () => {
    const on = await loadDevMode("1");
    expect(typeof on.DEV_MODE).toBe("boolean");
    const off = await loadDevMode("nope");
    expect(typeof off.DEV_MODE).toBe("boolean");
  });
});

describe("devMode — useDevMode() (pass-through of DEV_MODE)", () => {
  it("returns exactly true in the DEV build (env === '1'), matching DEV_MODE", async () => {
    const { useDevMode, DEV_MODE } = await loadDevMode("1");
    expect(useDevMode()).toBe(true);
    expect(useDevMode()).toBe(DEV_MODE);
  });

  it("returns exactly false in the production build (env unset), matching DEV_MODE", async () => {
    const { useDevMode, DEV_MODE } = await loadDevMode(undefined);
    expect(useDevMode()).toBe(false);
    expect(useDevMode()).toBe(DEV_MODE);
  });

  it("returns false for a non-'1' value (env === '0'), never independently re-reading env", async () => {
    const { useDevMode } = await loadDevMode("0");
    expect(useDevMode()).toBe(false);
  });

  it("is a stable pure function — two calls in the same build return the identical value", async () => {
    const { useDevMode } = await loadDevMode("1");
    expect(useDevMode()).toBe(useDevMode());
    expect(useDevMode()).toBe(true);
  });
});
