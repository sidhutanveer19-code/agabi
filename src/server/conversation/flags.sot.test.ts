import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * SOURCE_GROUNDING — SINGLE SOURCE OF TRUTH (Law 19).
 *
 * The rollout flag is deployment-safety infrastructure: it is the one-flip rollback for the entire
 * grounded teaching path (§I). Safety infrastructure with two owners is not safety infrastructure —
 * so this file pins the ownership itself, not just the behaviour.
 *
 * The defect this was written against: `src/env.ts` declared `.default("1")` (with a comment saying
 * "Default OFF"), exposed `SOURCE_GROUNDING_ON()`, and `flags.ts` separately read raw `process.env`
 * with an effective default of OFF. Zod defaults populate the PARSED object and are never written
 * back to `process.env`, so with the variable unset the two disagreed — and two test suites asserted
 * the opposite defaults, both green. Whichever reader a future change happened to pick would silently
 * decide whether every student got the grounded path.
 *
 * Three guarantees, in order of what they protect:
 *   1. BEHAVIOURAL AGREEMENT — the config view and the runtime reader answer identically for every
 *      value in the domain, including unset. This is the assertion that was red.
 *   2. ONE READER — exactly one non-test module reads the raw env var (static grep, the same
 *      technique `evidence/taxonomy.test.ts` uses to keep the event registry honest).
 *   3. ONE DEFAULT — the default literal is declared exactly once and imported everywhere else,
 *      so the two can never drift apart again.
 */

const ROOT = path.resolve(__dirname, "../../.."); // repo root
const SRC = path.join(ROOT, "src");

/** Every non-test, non-declaration `.ts` file under src/ — the production surface. */
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      productionSources(full, acc);
      continue;
    }
    if (!full.endsWith(".ts")) continue;
    if (full.endsWith(".test.ts") || full.endsWith(".d.ts")) continue;
    acc.push(full);
  }
  return acc;
}

const rel = (f: string) => path.relative(ROOT, f);
const FILES = productionSources(SRC);
const read = (f: string) => readFileSync(f, "utf8");

// ── 1. Behavioural agreement ────────────────────────────────────────────────────────────────────
// env.ts parses at import and its guards can throw, so each case clears the env, resets the module
// registry, and re-imports BOTH modules against the same environment.
const ENV_KEYS = [
  "NODE_ENV", "AUTH_MODE", "AUTH_SECRET", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY",
  "DATABASE_URL", "DIRECT_URL", "OBSERVATION_DATABASE_URL", "GOOGLE_API_KEY", "GROQ_API_KEY",
  "CEREBRAS_API_KEY", "NVIDIA_API_KEY", "OLLAMA_BASE_URL", "OLLAMA_ONLY", "RATE_LIMIT_PER_MIN",
  "MAX_DOC_BYTES", "KNOWLEDGE_GROUNDING", "SOURCE_GROUNDING", "WEB_GROUNDING", "TAVILY_API_KEY",
  "NEXT_PHASE", "E2E",
] as const;
const AUTH_BANNER = Symbol.for("agabi.authBanner");

const ORIGINAL: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k];
const ORIGINAL_BANNER = (globalThis as Record<symbol, unknown>)[AUTH_BANNER];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  (globalThis as Record<symbol, unknown>)[AUTH_BANNER] = true; // silence the boot banner
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string | undefined>)[k] = ORIGINAL[k];
  }
  if (ORIGINAL_BANNER === undefined) delete (globalThis as Record<symbol, unknown>)[AUTH_BANNER];
  else (globalThis as Record<symbol, unknown>)[AUTH_BANNER] = ORIGINAL_BANNER;
  vi.resetModules();
});

async function load(sourceGrounding: string | undefined) {
  for (const k of ENV_KEYS) delete process.env[k];
  if (sourceGrounding !== undefined) process.env.SOURCE_GROUNDING = sourceGrounding;
  vi.resetModules();
  const { env } = await import("@/env");
  const { sourceGroundingEnabled } = await import("@/server/conversation/flags");
  return { env, sourceGroundingEnabled };
}

describe("SOURCE_GROUNDING — the config view and the runtime reader never disagree", () => {
  // The whole domain, including the case that was broken: unset.
  for (const value of ["0", "1", undefined] as const) {
    it(`${value === undefined ? "unset" : `"${value}"`} → env and flags agree`, async () => {
      const { env, sourceGroundingEnabled } = await load(value);
      expect(sourceGroundingEnabled()).toBe(env.SOURCE_GROUNDING === "1");
    });
  }

  it("the shipped default is OFF — grounded teaching is opt-in, never opt-out (§I)", async () => {
    const { env, sourceGroundingEnabled } = await load(undefined);
    expect(env.SOURCE_GROUNDING).toBe("0");
    expect(sourceGroundingEnabled()).toBe(false);
  });

  it("rollback is deterministic: 1 → 0 restores the Phase-1 default exactly", async () => {
    const on = await load("1");
    expect(on.sourceGroundingEnabled()).toBe(true);
    const rolledBack = await load("0");
    expect(rolledBack.sourceGroundingEnabled()).toBe(false);
    const unset = await load(undefined);
    expect(unset.sourceGroundingEnabled()).toBe(false);
  });
});

// ── 2. One reader ───────────────────────────────────────────────────────────────────────────────
describe("SOURCE_GROUNDING — exactly one production reader", () => {
  it("only flags.ts reads the raw env var", () => {
    const readers = FILES.filter((f) => read(f).includes("process.env.SOURCE_GROUNDING")).map(rel);
    expect(readers).toEqual(["src/server/conversation/flags.ts"]);
  });

  it("no module exposes a second accessor for a grounding flag", () => {
    // `*_GROUNDING_ON` helpers were declared in env.ts and consumed by nothing, giving the flag a
    // second reader whose default disagreed. A future flag must not repeat the shape.
    const offenders = FILES.filter((f) => /\b[A-Z_]+_GROUNDING_ON\b/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

// ── 3. One default ──────────────────────────────────────────────────────────────────────────────
describe("SOURCE_GROUNDING — the default literal is declared once", () => {
  it("exactly one module declares SOURCE_GROUNDING_DEFAULT", () => {
    const declarers = FILES.filter((f) => /SOURCE_GROUNDING_DEFAULT\s*=/.test(read(f))).map(rel);
    expect(declarers).toEqual(["src/server/conversation/flags.ts"]);
  });

  it("env.ts derives its schema default from that constant rather than repeating the literal", () => {
    const envSrc = read(path.join(SRC, "env.ts"));
    expect(envSrc).toContain("SOURCE_GROUNDING_DEFAULT");
    // The bug was a hardcoded `.default("1")` next to a comment claiming OFF.
    expect(envSrc).not.toMatch(/SOURCE_GROUNDING:[^\n]*\.default\(\s*"[01]"\s*\)/);
  });
});
