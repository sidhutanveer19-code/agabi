import { z } from "zod";

/**
 * Advisor-side response envelopes. These SHAPE the model request (structured JSON output)
 * and are self-contained (import only zod) so the advisor stays within its wall — it may
 * not import knowledge/. The authoritative trust-boundary validation is the knowledge-side
 * schema (`knowledge/extraction/schemas.ts`) applied by `accept()`; these are loose on
 * purpose, letting the model respond and the platform be the strict judge.
 *
 * Note the deliberate ABSENCE of any trust/confidence/verified field: the model has no
 * field to assert its own trust into (ADR-2, prompt-injection defence §27).
 */
export const EntitiesResponse = z.object({
  entities: z.array(z.object({ name: z.string(), aliases: z.array(z.string()).optional(), kind: z.string().optional() })),
});

export const StatementsResponse = z.object({
  statements: z.array(
    z.object({
      form: z.string(),
      kind: z.string(),
      text: z.string(),
      quote: z.string(),
      structure: z.record(z.string(), z.unknown()).optional(),
      subject: z.string().optional(),
      predicate: z.string().optional(),
      object: z.string().optional(),
      objectLit: z.string().optional(),
    }),
  ),
});

export const DependenciesResponse = z.object({
  dependencies: z.array(
    z.object({ fromName: z.string(), toName: z.string(), classification: z.string(), type: z.string().optional() }),
  ),
});
