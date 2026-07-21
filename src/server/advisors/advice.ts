import type { z } from "zod";

/**
 * The trust boundary, in the type system. An advisor (a model call) returns
 * `Advice<T>` — a branded wrapper around UNTRUSTED raw model output. The ONLY way
 * to get a usable `T` out is `accept()`, which validates against a schema and
 * returns null on any failure. State mutators take plain `T`, never `Advice<T>`,
 * so raw model output can never reach `createLesson`/`advanceCursor`/… — it fails
 * to compile. Validation is not a convention to remember; it is the only path
 * through the types.
 */
export type Advice<T> = { readonly __brand: "advice"; readonly raw: unknown };

/** Wrap raw model output as advice. Advisors call this; nobody else needs to. */
export function advise<T>(raw: unknown): Advice<T> {
  return { __brand: "advice", raw };
}

/** The ONLY unwrap. Returns the validated value, or null on ANY failure. Never throws. */
export function accept<T>(a: Advice<T>, schema: z.ZodType<T>): T | null {
  const r = schema.safeParse(a.raw);
  return r.success ? r.data : null;
}
