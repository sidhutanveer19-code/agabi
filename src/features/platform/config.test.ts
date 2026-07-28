import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * platform/config — backend-connection constants derived from process.env AT
 * IMPORT TIME. The ONLY I/O edge is the environment (`process.env`); it is the
 * thing faked here. Nothing else is stubbed — the real expressions run:
 *   API_BASE_URL          = (env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "")
 *   HAS_BACKEND           = true (constant)
 *   HAS_SERVER_PERSISTENCE= API_BASE_URL.length > 0 || env.NEXT_PUBLIC_SERVER_PERSISTENCE === "1"
 *   REQUEST_TIMEOUT       = 20_000 (constant)
 *
 * Because the constants are computed once at module top-level, each case sets the
 * env, `vi.resetModules()`, then dynamically re-imports so the top-level code
 * re-evaluates against that env. Every assertion names the EXACT expected value.
 *
 * Branches under test:
 *   - `??`  left operand kept (env is a present string, incl. "") vs right operand ""
 *     (env is undefined/unset)
 *   - `.replace(/\/$/, "")` matches (one trailing slash stripped) vs no match (unchanged);
 *     edge: MULTIPLE trailing slashes → exactly ONE stripped (regex is not greedy/global);
 *     edge: "/" alone → ""; edge: whitespace kept verbatim (no trim)
 *   - HAS_SERVER_PERSISTENCE OR: first operand true (base non-empty, short-circuit),
 *     second operand true (base empty + flag === "1"), both false, and strict `=== "1"`
 *     (rejects "0", "true", "1 ")
 *   - interaction: base "/" strips to "" → length 0 → OR falls to the flag
 *   - HAS_BACKEND / REQUEST_TIMEOUT constants unaffected by env
 */

type ConfigModule = typeof import("@/features/platform/config");

const ENV_KEYS = ["NEXT_PUBLIC_API_BASE_URL", "NEXT_PUBLIC_SERVER_PERSISTENCE"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

let saved: Record<EnvKey, string | undefined>;

beforeEach(() => {
  saved = { NEXT_PUBLIC_API_BASE_URL: undefined, NEXT_PUBLIC_SERVER_PERSISTENCE: undefined };
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

/**
 * Fully control both env keys (absent/undefined ⇒ the key is DELETED, so
 * `process.env[k] === undefined` and the `??` right operand can fire), reset the
 * module cache, then re-import so the constants recompute against this env.
 */
async function loadConfig(env: Partial<Record<EnvKey, string | undefined>>): Promise<ConfigModule> {
  for (const k of ENV_KEYS) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  return import("@/features/platform/config");
}

describe("config — API_BASE_URL (?? and trailing-slash strip)", () => {
  it("unset env → '' via the ?? RIGHT operand (process.env key is undefined)", async () => {
    const { API_BASE_URL } = await loadConfig({ NEXT_PUBLIC_API_BASE_URL: undefined });
    expect(API_BASE_URL).toBe("");
  });

  it("empty string '' → '' via the ?? LEFT operand ('' is present, not null/undefined)", async () => {
    const { API_BASE_URL } = await loadConfig({ NEXT_PUBLIC_API_BASE_URL: "" });
    expect(API_BASE_URL).toBe("");
  });

  it("no trailing slash → returned verbatim (replace is a no-op)", async () => {
    const { API_BASE_URL } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.com",
    });
    expect(API_BASE_URL).toBe("https://api.example.com");
  });

  it("single trailing slash → exactly that one slash stripped", async () => {
    const { API_BASE_URL } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/",
    });
    expect(API_BASE_URL).toBe("https://api.example.com");
  });

  it("MULTIPLE trailing slashes → only ONE stripped (regex /\\/$/ is not greedy/global)", async () => {
    const { API_BASE_URL } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.com//",
    });
    expect(API_BASE_URL).toBe("https://api.example.com/");
  });

  it("'/' alone → '' (the single char is stripped, leaving empty)", async () => {
    const { API_BASE_URL } = await loadConfig({ NEXT_PUBLIC_API_BASE_URL: "/" });
    expect(API_BASE_URL).toBe("");
  });

  it("interior slash + trailing slash on :8787 mock oracle → only the trailing one goes", async () => {
    const { API_BASE_URL } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:8787/",
    });
    expect(API_BASE_URL).toBe("http://localhost:8787");
  });

  it("whitespace-only value → kept verbatim, NOT trimmed (no trailing slash to strip)", async () => {
    const { API_BASE_URL } = await loadConfig({ NEXT_PUBLIC_API_BASE_URL: "   " });
    expect(API_BASE_URL).toBe("   ");
  });
});

describe("config — HAS_SERVER_PERSISTENCE (|| short-circuit + strict '1')", () => {
  it("base non-empty, flag unset → true via the FIRST operand (length > 0 short-circuits)", async () => {
    const { API_BASE_URL, HAS_SERVER_PERSISTENCE } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.com",
      NEXT_PUBLIC_SERVER_PERSISTENCE: undefined,
    });
    expect(API_BASE_URL.length).toBeGreaterThan(0);
    expect(HAS_SERVER_PERSISTENCE).toBe(true);
  });

  it("base empty, flag === '1' → true via the SECOND operand", async () => {
    const { API_BASE_URL, HAS_SERVER_PERSISTENCE } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: undefined,
      NEXT_PUBLIC_SERVER_PERSISTENCE: "1",
    });
    expect(API_BASE_URL).toBe("");
    expect(HAS_SERVER_PERSISTENCE).toBe(true);
  });

  it("base empty, flag unset → false (both operands false)", async () => {
    const { HAS_SERVER_PERSISTENCE } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: undefined,
      NEXT_PUBLIC_SERVER_PERSISTENCE: undefined,
    });
    expect(HAS_SERVER_PERSISTENCE).toBe(false);
  });

  it("base empty, flag === '0' → false (strict !== '1')", async () => {
    const { HAS_SERVER_PERSISTENCE } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: undefined,
      NEXT_PUBLIC_SERVER_PERSISTENCE: "0",
    });
    expect(HAS_SERVER_PERSISTENCE).toBe(false);
  });

  it("base empty, flag === 'true' → false (only the literal '1' enables it)", async () => {
    const { HAS_SERVER_PERSISTENCE } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: undefined,
      NEXT_PUBLIC_SERVER_PERSISTENCE: "true",
    });
    expect(HAS_SERVER_PERSISTENCE).toBe(false);
  });

  it("base empty, flag === '1 ' (trailing space) → false (strict equality, no trim)", async () => {
    const { HAS_SERVER_PERSISTENCE } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: undefined,
      NEXT_PUBLIC_SERVER_PERSISTENCE: "1 ",
    });
    expect(HAS_SERVER_PERSISTENCE).toBe(false);
  });

  it("base '/' → strips to '' → length 0 → OR falls through to the (unset) flag → false", async () => {
    const { API_BASE_URL, HAS_SERVER_PERSISTENCE } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: "/",
      NEXT_PUBLIC_SERVER_PERSISTENCE: undefined,
    });
    expect(API_BASE_URL).toBe("");
    expect(HAS_SERVER_PERSISTENCE).toBe(false);
  });

  it("base '/' (→ '') BUT flag === '1' → true via the second operand", async () => {
    const { API_BASE_URL, HAS_SERVER_PERSISTENCE } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: "/",
      NEXT_PUBLIC_SERVER_PERSISTENCE: "1",
    });
    expect(API_BASE_URL).toBe("");
    expect(HAS_SERVER_PERSISTENCE).toBe(true);
  });

  it("base non-empty AND flag === '1' → true (both operands true)", async () => {
    const { HAS_SERVER_PERSISTENCE } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.com",
      NEXT_PUBLIC_SERVER_PERSISTENCE: "1",
    });
    expect(HAS_SERVER_PERSISTENCE).toBe(true);
  });
});

describe("config — constants (env-independent)", () => {
  it("HAS_BACKEND is always true, even with hostile env", async () => {
    const { HAS_BACKEND } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: undefined,
      NEXT_PUBLIC_SERVER_PERSISTENCE: "0",
    });
    expect(HAS_BACKEND).toBe(true);
  });

  it("REQUEST_TIMEOUT is exactly the number 20000, regardless of env", async () => {
    const { REQUEST_TIMEOUT } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/",
      NEXT_PUBLIC_SERVER_PERSISTENCE: "1",
    });
    expect(REQUEST_TIMEOUT).toBe(20000);
    expect(typeof REQUEST_TIMEOUT).toBe("number");
  });
});
