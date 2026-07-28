import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * src/env.ts — the boot-time server env schema (Zod over process.env) plus the
 * fail-fast RUNTIME guards that run at IMPORT, and the three grounding-flag helpers.
 *
 * The file's own note marks it "@no-test-ok" because its guards throw at import; but
 * that is exactly what makes it unit-testable the same way `config/devMode` is: every
 * value is derived from `process.env` at module top-level, so each case sets the env,
 * `vi.resetModules()`, then dynamically re-imports so the top-level schema-parse AND
 * the guard block re-evaluate against that env. The ONLY external edge is the
 * environment; nothing else is stubbed. A guard that throws is asserted with
 * `rejects.toThrow(<exact message>)`; a valid boot is asserted by inspecting `env`.
 *
 * Determinism: `loadEnv` DELETES every schema/control key first, then applies only the
 * overrides the case names, so results never depend on the ambient shell env. The
 * console banner is deduped on a `Symbol.for("agabi.authBanner")` slot on globalThis —
 * that slot survives `resetModules`, so it is managed explicitly per case.
 */

type EnvModule = typeof import("@/env");

// Every key the module reads: the Zod schema keys + the two control keys read directly
// off process.env (NEXT_PHASE, E2E). All are cleared before each load for isolation.
const SCHEMA_KEYS = [
  "NODE_ENV",
  "AUTH_MODE",
  "AUTH_SECRET",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "DIRECT_URL",
  "OBSERVATION_DATABASE_URL",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "NVIDIA_API_KEY",
  "OLLAMA_BASE_URL",
  "OLLAMA_ONLY",
  "RATE_LIMIT_PER_MIN",
  "MAX_DOC_BYTES",
  "KNOWLEDGE_GROUNDING",
  "SOURCE_GROUNDING",
  "WEB_GROUNDING",
  "TAVILY_API_KEY",
] as const;
const CONTROL_KEYS = ["NEXT_PHASE", "E2E"] as const;
const ALL_KEYS = [...SCHEMA_KEYS, ...CONTROL_KEYS] as const;

// The in-repo dev default the module refuses to boot with in production (mirrors the
// module's own DEV_AUTH_SECRET, which is not exported).
const DEV_AUTH_SECRET = "dev-insecure-secret-change-me-0000";
const BUILD_PHASE = "phase-production-build";
const AUTH_BANNER = Symbol.for("agabi.authBanner");

// Exact banner strings (em dash included) — asserted verbatim so a mutated message dies.
const DEV_BANNER = "auth: dev (anon cookie, HMAC-signed, 1yr — no sign-in)";
const CLERK_BANNER = "auth: clerk (Clerk session; sign-in required)";

// A fully-valid production configuration: real Clerk keys + a real (non-default) secret,
// so guards 1–3 all pass. Reused wherever a case needs to isolate ONE later branch.
const PROD_VALID = {
  NODE_ENV: "production",
  AUTH_MODE: "clerk",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_valid",
  CLERK_SECRET_KEY: "sk_test_valid",
  AUTH_SECRET: "prod-real-secret-0123456789",
} as const;

// Snapshot the ambient values once so afterEach restores the process for later files.
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const k of ALL_KEYS) ORIGINAL_ENV[k] = process.env[k];
const ORIGINAL_BANNER = (globalThis as Record<symbol, unknown>)[AUTH_BANNER];

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Silence + observe the boot banner. Pre-set the dedupe slot so, by default, loads do
  // NOT log (quiet, deterministic); banner-specific cases delete it to force a log.
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  (globalThis as Record<symbol, unknown>)[AUTH_BANNER] = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ALL_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string | undefined>)[k] = ORIGINAL_ENV[k];
  }
  if (ORIGINAL_BANNER === undefined) delete (globalThis as Record<symbol, unknown>)[AUTH_BANNER];
  else (globalThis as Record<symbol, unknown>)[AUTH_BANNER] = ORIGINAL_BANNER;
  vi.resetModules();
});

/**
 * Clear EVERY key, apply `overrides` (undefined value ⇒ key stays deleted), reset the
 * module registry, then re-import so both the schema parse and the guard block run fresh.
 */
async function loadEnv(overrides: Record<string, string | undefined> = {}): Promise<EnvModule> {
  for (const k of ALL_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  return import("@/env");
}

// ── schema: defaults, coercion, optional passthrough, validation ─────────────────
describe("env schema — defaults", () => {
  it("empty env → every default resolves to its documented value", async () => {
    const { env } = await loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.AUTH_MODE).toBe("dev");
    expect(env.AUTH_SECRET).toBe(DEV_AUTH_SECRET);
    expect(env.RATE_LIMIT_PER_MIN).toBe(10);
    expect(env.MAX_DOC_BYTES).toBe(2_000_000);
    expect(env.KNOWLEDGE_GROUNDING).toBe("0");
    expect(env.SOURCE_GROUNDING).toBe("0");
    expect(env.WEB_GROUNDING).toBe("0");
  });

  it("absent optional keys are undefined; provided ones pass through verbatim", async () => {
    const { env } = await loadEnv({ GROQ_API_KEY: "gk-123", TAVILY_API_KEY: "tv-456" });
    expect(env.GROQ_API_KEY).toBe("gk-123");
    expect(env.TAVILY_API_KEY).toBe("tv-456");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.OBSERVATION_DATABASE_URL).toBeUndefined();
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
  });

  it("RATE_LIMIT_PER_MIN coerces a numeric string to a real number", async () => {
    const { env } = await loadEnv({ RATE_LIMIT_PER_MIN: "25" });
    expect(env.RATE_LIMIT_PER_MIN).toBe(25);
    expect(typeof env.RATE_LIMIT_PER_MIN).toBe("number");
  });

  it("MAX_DOC_BYTES coerces a numeric string to a real number", async () => {
    const { env } = await loadEnv({ MAX_DOC_BYTES: "500" });
    expect(env.MAX_DOC_BYTES).toBe(500);
  });

  it("RATE_LIMIT_PER_MIN='0' fails .positive() → parse throws at import", async () => {
    await expect(loadEnv({ RATE_LIMIT_PER_MIN: "0" })).rejects.toThrow();
  });

  it("RATE_LIMIT_PER_MIN='3.5' fails .int() → parse throws at import", async () => {
    await expect(loadEnv({ RATE_LIMIT_PER_MIN: "3.5" })).rejects.toThrow();
  });

  it("AUTH_SECRET of 15 chars fails .min(16) → parse throws (below boundary)", async () => {
    await expect(loadEnv({ AUTH_SECRET: "a".repeat(15) })).rejects.toThrow();
  });

  it("AUTH_SECRET of exactly 16 chars passes .min(16) (at boundary)", async () => {
    const { env } = await loadEnv({ AUTH_SECRET: "a".repeat(16) });
    expect(env.AUTH_SECRET).toBe("a".repeat(16));
  });

  it("KNOWLEDGE_GROUNDING='2' is outside the enum → parse throws", async () => {
    await expect(loadEnv({ KNOWLEDGE_GROUNDING: "2" })).rejects.toThrow();
  });
});

// ── grounding flag helpers ───────────────────────────────────────────────────────
describe("grounding flags — KNOWLEDGE / SOURCE / WEB", () => {
  it("KNOWLEDGE_GROUNDING_ON(): '1' → true, default '0' → false", async () => {
    const on = await loadEnv({ KNOWLEDGE_GROUNDING: "1" });
    expect(on.KNOWLEDGE_GROUNDING_ON()).toBe(true);
    const off = await loadEnv({});
    expect(off.KNOWLEDGE_GROUNDING_ON()).toBe(false);
  });

  it("SOURCE_GROUNDING_ON(): '1' → true, default '0' → false", async () => {
    const on = await loadEnv({ SOURCE_GROUNDING: "1" });
    expect(on.SOURCE_GROUNDING_ON()).toBe(true);
    const off = await loadEnv({});
    expect(off.SOURCE_GROUNDING_ON()).toBe(false);
  });

  it("WEB_GROUNDING_ON(): '1' → true, default '0' → false", async () => {
    const on = await loadEnv({ WEB_GROUNDING: "1" });
    expect(on.WEB_GROUNDING_ON()).toBe(true);
    const off = await loadEnv({});
    expect(off.WEB_GROUNDING_ON()).toBe(false);
  });

  it("the three flags are independent — one '1' does not turn the others on", async () => {
    const { KNOWLEDGE_GROUNDING_ON, SOURCE_GROUNDING_ON, WEB_GROUNDING_ON } = await loadEnv({
      SOURCE_GROUNDING: "1",
    });
    expect(SOURCE_GROUNDING_ON()).toBe(true);
    expect(KNOWLEDGE_GROUNDING_ON()).toBe(false);
    expect(WEB_GROUNDING_ON()).toBe(false);
  });
});

// ── guard 1: dev auth in production ────────────────────────────────────────────────
describe("guard 1 — refuse dev auth in production", () => {
  it("production + dev + no build + no E2E → throws the dev-auth message", async () => {
    await expect(loadEnv({ NODE_ENV: "production", AUTH_MODE: "dev" })).rejects.toThrow(
      "Refusing to boot: AUTH_MODE=dev in production. Wire real auth (Clerk) first.",
    );
  });

  it("development + dev → boots (NODE_ENV operand is what gates it)", async () => {
    const { env } = await loadEnv({ NODE_ENV: "development", AUTH_MODE: "dev" });
    expect(env.NODE_ENV).toBe("development");
    expect(env.AUTH_MODE).toBe("dev");
  });

  it("production + clerk (valid keys) → guard 1 does not fire (AUTH_MODE operand)", async () => {
    const { env } = await loadEnv(PROD_VALID);
    expect(env.NODE_ENV).toBe("production");
    expect(env.AUTH_MODE).toBe("clerk");
  });

  it("production + dev but NEXT_PHASE=build → skipped (build exemption)", async () => {
    const { env } = await loadEnv({ NODE_ENV: "production", AUTH_MODE: "dev", NEXT_PHASE: BUILD_PHASE });
    expect(env.NODE_ENV).toBe("production");
    expect(env.AUTH_MODE).toBe("dev");
  });

  it("production + dev but E2E=1 (with a real secret) → skipped (e2e exemption)", async () => {
    // Real secret so guard 2 stays silent, isolating guard 1's E2E exemption.
    const { env } = await loadEnv({
      NODE_ENV: "production",
      AUTH_MODE: "dev",
      E2E: "1",
      AUTH_SECRET: "prod-real-secret-0123456789",
    });
    expect(env.NODE_ENV).toBe("production");
    expect(env.AUTH_MODE).toBe("dev");
  });
});

// ── guard 2: dev-default AUTH_SECRET in production ─────────────────────────────────
describe("guard 2 — refuse the public dev AUTH_SECRET in production", () => {
  it("production + clerk keys + default secret → throws the AUTH_SECRET message", async () => {
    // AUTH_MODE=clerk (+keys) makes guard 1 & 3 pass so guard 2 is the one that fires.
    await expect(
      loadEnv({
        NODE_ENV: "production",
        AUTH_MODE: "clerk",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_valid",
        CLERK_SECRET_KEY: "sk_test_valid",
        AUTH_SECRET: DEV_AUTH_SECRET,
      }),
    ).rejects.toThrow(
      "Refusing to boot: AUTH_SECRET is the public dev default in production. Set a real, secret AUTH_SECRET.",
    );
  });

  it("production + a real secret → guard 2 does not fire (AUTH_SECRET operand)", async () => {
    const { env } = await loadEnv(PROD_VALID);
    expect(env.AUTH_SECRET).toBe(PROD_VALID.AUTH_SECRET);
  });

  it("development + default secret → guard 2 does not fire (NODE_ENV operand)", async () => {
    const { env } = await loadEnv({ NODE_ENV: "development" });
    expect(env.AUTH_SECRET).toBe(DEV_AUTH_SECRET);
  });

  it("production + default secret but NEXT_PHASE=build → skipped (build exemption)", async () => {
    // Build exemption also lets guard 1 pass, so this boots despite dev auth + dev secret.
    const { env } = await loadEnv({
      NODE_ENV: "production",
      AUTH_MODE: "dev",
      AUTH_SECRET: DEV_AUTH_SECRET,
      NEXT_PHASE: BUILD_PHASE,
    });
    expect(env.AUTH_SECRET).toBe(DEV_AUTH_SECRET);
  });
});

// ── guard 3: clerk mode requires clerk keys ───────────────────────────────────────
describe("guard 3 — clerk mode requires both Clerk keys", () => {
  it("clerk + no keys → throws the clerk-keys message", async () => {
    await expect(loadEnv({ NODE_ENV: "development", AUTH_MODE: "clerk" })).rejects.toThrow(
      "Refusing to boot: AUTH_MODE=clerk but NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY are not set.",
    );
  });

  it("clerk + publishable key only (secret missing) → still throws (!SECRET operand)", async () => {
    await expect(
      loadEnv({ NODE_ENV: "development", AUTH_MODE: "clerk", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_x" }),
    ).rejects.toThrow("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY are not set");
  });

  it("clerk + secret key only (publishable missing) → still throws (!PUB operand)", async () => {
    await expect(
      loadEnv({ NODE_ENV: "development", AUTH_MODE: "clerk", CLERK_SECRET_KEY: "sk_x" }),
    ).rejects.toThrow("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY are not set");
  });

  it("clerk + both keys → boots (guard 3 passes)", async () => {
    const { env } = await loadEnv({
      NODE_ENV: "development",
      AUTH_MODE: "clerk",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_x",
      CLERK_SECRET_KEY: "sk_x",
    });
    expect(env.AUTH_MODE).toBe("clerk");
    expect(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe("pk_x");
    expect(env.CLERK_SECRET_KEY).toBe("sk_x");
  });

  it("dev mode + no clerk keys → guard 3 does not fire (AUTH_MODE operand)", async () => {
    const { env } = await loadEnv({ NODE_ENV: "development", AUTH_MODE: "dev" });
    expect(env.AUTH_MODE).toBe("dev");
  });

  it("clerk + no keys but NEXT_PHASE=build → skipped (build exemption)", async () => {
    const { env } = await loadEnv({ NODE_ENV: "development", AUTH_MODE: "clerk", NEXT_PHASE: BUILD_PHASE });
    expect(env.AUTH_MODE).toBe("clerk");
  });
});

// ── boot banner (console.log, deduped on globalThis) ──────────────────────────────
describe("auth banner", () => {
  it("dev mode, slot unset, not a build → logs the DEV banner once and sets the slot", async () => {
    delete (globalThis as Record<symbol, unknown>)[AUTH_BANNER];
    await loadEnv({ NODE_ENV: "development", AUTH_MODE: "dev" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(DEV_BANNER);
    expect((globalThis as Record<symbol, unknown>)[AUTH_BANNER]).toBe(true);
  });

  it("clerk mode (valid keys), slot unset → logs the CLERK banner (ternary true side)", async () => {
    delete (globalThis as Record<symbol, unknown>)[AUTH_BANNER];
    await loadEnv({
      NODE_ENV: "development",
      AUTH_MODE: "clerk",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_x",
      CLERK_SECRET_KEY: "sk_x",
    });
    expect(logSpy).toHaveBeenCalledWith(CLERK_BANNER);
    expect(logSpy).not.toHaveBeenCalledWith(DEV_BANNER);
  });

  it("slot already set → banner is suppressed (dedupe operand)", async () => {
    // beforeEach pre-set the slot; do not delete it.
    await loadEnv({ NODE_ENV: "development", AUTH_MODE: "dev" });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("NEXT_PHASE=build, slot unset → suppressed and slot left unset (build operand)", async () => {
    delete (globalThis as Record<symbol, unknown>)[AUTH_BANNER];
    await loadEnv({ NODE_ENV: "development", AUTH_MODE: "dev", NEXT_PHASE: BUILD_PHASE });
    expect(logSpy).not.toHaveBeenCalled();
    expect((globalThis as Record<symbol, unknown>)[AUTH_BANNER]).toBeUndefined();
  });
});

// ── guard 5: OLLAMA_ONLY in production ─────────────────────────────────────────────
describe("guard 5 — refuse OLLAMA_ONLY=1 in production", () => {
  it("production (valid auth) + OLLAMA_ONLY=1 → throws the OLLAMA message", async () => {
    await expect(loadEnv({ ...PROD_VALID, OLLAMA_ONLY: "1" })).rejects.toThrow(
      "Refusing to boot: OLLAMA_ONLY=1 in production. It is a local-testing flag only.",
    );
  });

  it("production (valid auth) + OLLAMA_ONLY unset → boots (OLLAMA_ONLY operand)", async () => {
    const { env } = await loadEnv(PROD_VALID);
    expect(env.OLLAMA_ONLY).toBeUndefined();
  });

  it("production (valid auth) + OLLAMA_ONLY='0' → boots (strict === '1')", async () => {
    const { env } = await loadEnv({ ...PROD_VALID, OLLAMA_ONLY: "0" });
    expect(env.OLLAMA_ONLY).toBe("0");
  });

  it("development + OLLAMA_ONLY=1 → boots (NODE_ENV operand)", async () => {
    const { env } = await loadEnv({ NODE_ENV: "development", OLLAMA_ONLY: "1" });
    expect(env.OLLAMA_ONLY).toBe("1");
  });

  it("production + OLLAMA_ONLY=1 but NEXT_PHASE=build → skipped (build exemption)", async () => {
    // Build exemption also clears guards 1 & 2, so a plain dev config boots here.
    const { env } = await loadEnv({
      NODE_ENV: "production",
      AUTH_MODE: "dev",
      AUTH_SECRET: DEV_AUTH_SECRET,
      OLLAMA_ONLY: "1",
      NEXT_PHASE: BUILD_PHASE,
    });
    expect(env.OLLAMA_ONLY).toBe("1");
  });

  it("production (valid auth) + OLLAMA_ONLY=1 + E2E=1 → STILL throws (no E2E exemption here)", async () => {
    // Unlike guard 1, guard 5 has no E2E escape hatch — E2E must not smuggle the flag into prod.
    await expect(loadEnv({ ...PROD_VALID, OLLAMA_ONLY: "1", E2E: "1" })).rejects.toThrow(
      "Refusing to boot: OLLAMA_ONLY=1 in production. It is a local-testing flag only.",
    );
  });
});

// ── schema: enum members accepted + non-members rejected ──────────────────────────
describe("env schema — enum members & rejections", () => {
  it("NODE_ENV='test' is a valid member → boots and passes through verbatim", async () => {
    // The third enum member ("test") is never reached by the guards (all need production),
    // so it must boot cleanly with the value preserved.
    const { env } = await loadEnv({ NODE_ENV: "test" });
    expect(env.NODE_ENV).toBe("test");
  });

  it("NODE_ENV='staging' is outside the enum → parse throws at import", async () => {
    await expect(loadEnv({ NODE_ENV: "staging" })).rejects.toThrow();
  });

  it("AUTH_MODE='oauth' is outside the enum → parse throws at import", async () => {
    await expect(loadEnv({ AUTH_MODE: "oauth" })).rejects.toThrow();
  });

  it("SOURCE_GROUNDING='2' is outside the '0'|'1' enum → parse throws", async () => {
    await expect(loadEnv({ SOURCE_GROUNDING: "2" })).rejects.toThrow();
  });

  it("WEB_GROUNDING='yes' is outside the '0'|'1' enum → parse throws", async () => {
    await expect(loadEnv({ WEB_GROUNDING: "yes" })).rejects.toThrow();
  });

  it("KNOWLEDGE/SOURCE/WEB accept the explicit '0' member (not only the default)", async () => {
    const { env } = await loadEnv({
      KNOWLEDGE_GROUNDING: "0",
      SOURCE_GROUNDING: "0",
      WEB_GROUNDING: "0",
    });
    expect(env.KNOWLEDGE_GROUNDING).toBe("0");
    expect(env.SOURCE_GROUNDING).toBe("0");
    expect(env.WEB_GROUNDING).toBe("0");
  });
});

// ── schema: MAX_DOC_BYTES coercion + int/positive rejections (mirror of RATE_LIMIT) ─
describe("env schema — MAX_DOC_BYTES numeric guard", () => {
  it("MAX_DOC_BYTES='1' passes .positive() (lower boundary) and coerces to 1", async () => {
    const { env } = await loadEnv({ MAX_DOC_BYTES: "1" });
    expect(env.MAX_DOC_BYTES).toBe(1);
    expect(typeof env.MAX_DOC_BYTES).toBe("number");
  });

  it("MAX_DOC_BYTES='0' fails .positive() → parse throws (at the boundary)", async () => {
    await expect(loadEnv({ MAX_DOC_BYTES: "0" })).rejects.toThrow();
  });

  it("MAX_DOC_BYTES='-100' fails .positive() → parse throws (negative)", async () => {
    await expect(loadEnv({ MAX_DOC_BYTES: "-100" })).rejects.toThrow();
  });

  it("MAX_DOC_BYTES='2.5' fails .int() → parse throws (non-integer)", async () => {
    await expect(loadEnv({ MAX_DOC_BYTES: "2.5" })).rejects.toThrow();
  });

  it("MAX_DOC_BYTES='abc' coerces to NaN → fails .int() → parse throws", async () => {
    await expect(loadEnv({ MAX_DOC_BYTES: "abc" })).rejects.toThrow();
  });
});

// ── schema: RATE_LIMIT_PER_MIN — extra rejection + boundary cases ──────────────────
describe("env schema — RATE_LIMIT_PER_MIN extra edges", () => {
  it("RATE_LIMIT_PER_MIN='1' passes .positive() (lower boundary) and coerces to 1", async () => {
    const { env } = await loadEnv({ RATE_LIMIT_PER_MIN: "1" });
    expect(env.RATE_LIMIT_PER_MIN).toBe(1);
  });

  it("RATE_LIMIT_PER_MIN='-5' fails .positive() → parse throws (negative)", async () => {
    await expect(loadEnv({ RATE_LIMIT_PER_MIN: "-5" })).rejects.toThrow();
  });

  it("RATE_LIMIT_PER_MIN='abc' coerces to NaN → fails .int() → parse throws", async () => {
    await expect(loadEnv({ RATE_LIMIT_PER_MIN: "abc" })).rejects.toThrow();
  });
});

// ── grounding flags — all three on together (each reads its OWN key) ───────────────
describe("grounding flags — all enabled simultaneously", () => {
  it("KNOWLEDGE=SOURCE=WEB='1' → all three helpers return true", async () => {
    const { KNOWLEDGE_GROUNDING_ON, SOURCE_GROUNDING_ON, WEB_GROUNDING_ON } = await loadEnv({
      KNOWLEDGE_GROUNDING: "1",
      SOURCE_GROUNDING: "1",
      WEB_GROUNDING: "1",
    });
    expect(KNOWLEDGE_GROUNDING_ON()).toBe(true);
    expect(SOURCE_GROUNDING_ON()).toBe(true);
    expect(WEB_GROUNDING_ON()).toBe(true);
  });
});

// ── guard 3 also fires in PRODUCTION (past guards 1 & 2 with a real secret) ────────
describe("guard 3 — clerk-keys check fires in production too", () => {
  it("production + clerk + real secret + only publishable key → throws the clerk-keys message", async () => {
    // A real secret slips past guard 2; clerk mode slips past guard 1; the missing CLERK_SECRET_KEY
    // is what stops the boot — proving guard 3 runs regardless of NODE_ENV.
    await expect(
      loadEnv({
        NODE_ENV: "production",
        AUTH_MODE: "clerk",
        AUTH_SECRET: "prod-real-secret-0123456789",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_valid",
      }),
    ).rejects.toThrow(
      "Refusing to boot: AUTH_MODE=clerk but NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY are not set.",
    );
  });
});
