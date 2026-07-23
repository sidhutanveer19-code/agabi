import { z } from "zod";

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
});

export const env = schema.parse(process.env);

/** M5 grounding flag — the ONE switch that makes the knowledge platform student-visible. */
export const KNOWLEDGE_GROUNDING_ON = () => env.KNOWLEDGE_GROUNDING === "1";

// Hard fail at RUNTIME: production must never serve the dev auth stub. Skipped
// during `next build` (NEXT_PHASE set), which runs in production mode with no env.
if (
  env.NODE_ENV === "production" &&
  env.AUTH_MODE === "dev" &&
  process.env.NEXT_PHASE !== "phase-production-build"
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

// OLLAMA_ONLY is a local test switch; shipping it enabled routes production traffic
// at a laptop that isn't there.
if (
  env.OLLAMA_ONLY === "1" &&
  env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error("Refusing to boot: OLLAMA_ONLY=1 in production. It is a local-testing flag only.");
}
