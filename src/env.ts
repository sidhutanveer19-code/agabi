import { z } from "zod";

/**
 * Server env — Zod over process.env, fail-fast at boot. Server-only (never import
 * from client code). Free providers only; every key is optional so the app boots
 * and the provider chain simply skips absent keys (D5: build without keys).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_MODE: z.enum(["dev", "clerk"]).default("dev"),
  AUTH_SECRET: z.string().min(16).default("dev-insecure-secret-change-me-0000"),

  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),

  // Free model providers (D2 chain). Absent key → skipped, never crashes.
  GOOGLE_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  CEREBRAS_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),

  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  MAX_DOC_BYTES: z.coerce.number().int().positive().default(2_000_000),
});

export const env = schema.parse(process.env);

// Hard fail at RUNTIME: production must never serve the dev auth stub. Skipped
// during `next build` (NEXT_PHASE set), which runs in production mode with no env.
if (
  env.NODE_ENV === "production" &&
  env.AUTH_MODE === "dev" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error("Refusing to boot: AUTH_MODE=dev in production. Wire real auth (Clerk) first.");
}
