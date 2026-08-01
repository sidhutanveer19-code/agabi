// @no-test-ok: boot-time env schema + fail-fast runtime guards that run at IMPORT — the guard behaviour
// (incl. the E2E dev-auth-in-prod exemption) is exercised by the real boot in the e2e/smoke jobs, not a
// pure unit; unit-testing an import-time throw would fake the very thing under test.
import { z } from "zod";
// The rollout flag's default is OWNED by conversation/flags.ts (Law 19) — the module that actually
// reads it at runtime. Imported here so the boot-time schema validates the same value the pipeline
// uses, rather than declaring a second default that can drift. flags.ts is dependency-free, so this
// import pulls in no runtime behaviour.
import { SOURCE_GROUNDING_DEFAULT } from "@/server/conversation/flags";

/**
 * Server env — Zod over process.env, fail-fast at boot. Server-only (never import
 * from client code). Free providers only; every key is optional so the app boots
 * and the provider chain simply skips absent keys (D5: build without keys).
 */
/** The in-repo dev default for AUTH_SECRET. Public by definition — the production guard
 *  below refuses to boot with it, because it is the HMAC key that signs identity cookies. */
const DEV_AUTH_SECRET = "dev-insecure-secret-change-me-0000";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_MODE: z.enum(["dev", "clerk"]).default("dev"),
  AUTH_SECRET: z.string().min(16).default(DEV_AUTH_SECRET),
  // Clerk (AUTH_MODE=clerk). Read directly by @clerk/nextjs from process.env; declared here
  // so the guard below can fail fast if clerk mode is selected without its keys wired.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),

  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  // The observation store is a SEPARATE instance (§17.1, L6) so a DPDP erasure can never
  // touch the knowledge graph. Absent → the observation store is simply not wired.
  OBSERVATION_DATABASE_URL: z.string().optional(),

  // Free model providers (D2 chain). Absent key → skipped, never crashes.
  GOOGLE_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  CEREBRAS_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  // Test-only: force the provider chain to Ollama alone (Groq exhausted / Gemini
  // key invalid). Guarded below — must never be set in production.
  OLLAMA_ONLY: z.string().optional(),

  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  MAX_DOC_BYTES: z.coerce.number().int().positive().default(2_000_000),

  // M5 teaching bridge (§8.2). Default OFF: teaching is byte-identical to Phase 1 until a
  // human flips this on. Rollback is flipping it back — one env var, one line at the call
  // site. Needs the M0 knowledge db push before it can do anything.
  KNOWLEDGE_GROUNDING: z.enum(["0", "1"]).default("0"),

  // Phase 2 (A-7). Default OFF: teaching is byte-identical to Phase 1 until flipped. When on,
  // a topic the graph doesn't cover is taught from retrieved NCERT/Exemplar text (searchChunks),
  // rewritten by the model. Rollback = flip it back. Needs the corpus ingested (npm run ingest:corpus).
  // The default lives in conversation/flags.ts — the one module that reads this at runtime.
  SOURCE_GROUNDING: z.enum(["0", "1"]).default(SOURCE_GROUNDING_DEFAULT),

  // Phase 3 (A-7). Default OFF. When on, a topic NOT covered by the graph or the textbook is taught
  // from a web search (Tavily) — same mentor teaching, labelled web-sourced. Needs TAVILY_API_KEY.
  WEB_GROUNDING: z.enum(["0", "1"]).default("0"),
  TAVILY_API_KEY: z.string().optional(), // web-search key (Law 22 — secret in env, never in code)
});

export const env = schema.parse(process.env);

// NOTE — there are deliberately NO `*_GROUNDING_ON()` accessors here. They existed, were consumed by
// nothing, and gave each flag a second reader whose default disagreed with the module that actually
// read it (Law 19). A feature flag gets exactly one reader, and that reader lives beside the code it
// gates: `conversation/flags.ts` for SOURCE_GROUNDING. When KNOWLEDGE_GROUNDING and WEB_GROUNDING are
// wired, they follow the same shape — `flags.sot.test.ts` fails the build if this pattern comes back.

// Hard fail at RUNTIME: production must never serve the dev auth stub. Skipped
// during `next build` (NEXT_PHASE set), which runs in production mode with no env.
// Also skipped for the e2e harness (E2E=1): the Playwright suite runs a PRODUCTION build against the
// dev-backend STUB (real auth never exercised), so dev-mode is safe there. Real production never sets
// E2E — this exempts only the known test harness, exactly like the NEXT_PHASE build exemption.
if (
  env.NODE_ENV === "production" &&
  env.AUTH_MODE === "dev" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  process.env.E2E !== "1"
) {
  throw new Error("Refusing to boot: AUTH_MODE=dev in production. Wire real auth (Clerk) first.");
}

// Hard fail at RUNTIME: AUTH_SECRET is the HMAC key that signs identity cookies, so the
// committed dev default is a public key — booting with it in production lets anyone forge
// any user's session (and the outbox-drain cron secret). The AUTH_MODE guard above does not
// cover this, since the HMAC path runs regardless of mode. Skipped during `next build`.
if (
  env.NODE_ENV === "production" &&
  env.AUTH_SECRET === DEV_AUTH_SECRET &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error("Refusing to boot: AUTH_SECRET is the public dev default in production. Set a real, secret AUTH_SECRET.");
}

// AUTH_MODE=clerk requires Clerk's keys, or identity resolution silently fails. Fail fast at
// boot (skipped during `next build`, which has no env), like the guards above.
if (
  env.AUTH_MODE === "clerk" &&
  (!env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !env.CLERK_SECRET_KEY) &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error("Refusing to boot: AUTH_MODE=clerk but NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY are not set.");
}

// Announce which identity mode is live. The mirror of the guards above: those refuse a
// misconfiguration, this one makes a VALID-but-surprising configuration visible. AUTH_MODE lives in
// .env.local, which Next loads over .env, so the mode can silently differ from what the committed
// .env suggests — that is exactly how a stale Clerk session came to produce "Sign in first" 401s on
// a machine nobody thought was running Clerk. Skipped during `next build` (no env, and build logs
// are not where anyone looks for this).
const AUTH_BANNER = Symbol.for("agabi.authBanner");
if (
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !(globalThis as Record<symbol, unknown>)[AUTH_BANNER]
) {
  // Deduped on globalThis, not module scope: this module is evaluated once per server bundle, so
  // in dev a plain module-level flag printed the banner a dozen times.
  (globalThis as Record<symbol, unknown>)[AUTH_BANNER] = true;
  // eslint-disable-next-line no-console -- boot banner: one line, before any request
  console.log(
    env.AUTH_MODE === "clerk"
      ? "auth: clerk (Clerk session; sign-in required)"
      : "auth: dev (anon cookie, HMAC-signed, 1yr — no sign-in)",
  );
}

// OLLAMA_ONLY is a local test switch; shipping it enabled routes production traffic
// at a laptop that isn't there.
if (
  env.OLLAMA_ONLY === "1" &&
  env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error("Refusing to boot: OLLAMA_ONLY=1 in production. It is a local-testing flag only.");
}
