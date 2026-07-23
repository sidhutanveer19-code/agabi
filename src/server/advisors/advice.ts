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

/** One element the trust boundary refused, and exactly why. */
export interface DroppedElement {
  index: number;
  path: string;
  code: string;
  message: string;
  preview: string; // the offending element, truncated — so the reason is checkable, not just stated
}

/**
 * Element-wise unwrap for extraction ARRAYS (amendment A-6).
 *
 * The trust boundary is unchanged: every element still passes the same schema, and nothing
 * unvalidated reaches the platform. What is relaxed is *batch atomicity*, and only here.
 *
 * Why it had to change. `accept()` returns null on any failure, so a single malformed element
 * discarded the entire array. Measured on the real corpus with qwen2.5:7b: a chunk yielded eight
 * well-formed statements, one of which carried `form:"HISTORICAL"` — a value the model invented
 * that is not in the enum — and all eight were thrown away. Across a stalled run this produced 2.5
 * accepted proposals per chunk against ~30 needed, and 48% of chunks yielded nothing at all. The
 * all-or-nothing rule was not protecting the graph from bad data; it was deleting good data
 * because a local model cannot be relied on to keep a seven-value enum straight.
 *
 * A drop is never silent (R1): each rejected element comes back with its index, zod path and a
 * preview of the value, for the caller to record.
 */
export function acceptEach<T>(a: Advice<T[]>, elementSchema: z.ZodType<T>): { accepted: T[]; dropped: DroppedElement[] } {
  const raw = a.raw;
  if (!Array.isArray(raw)) {
    return {
      accepted: [],
      dropped: [{ index: -1, path: "(root)", code: "not_an_array", message: `expected an array, got ${raw === null ? "null" : typeof raw}`, preview: JSON.stringify(raw ?? null).slice(0, 200) }],
    };
  }
  const accepted: T[] = [];
  const dropped: DroppedElement[] = [];
  raw.forEach((element, index) => {
    const r = elementSchema.safeParse(element);
    if (r.success) {
      accepted.push(r.data);
      return;
    }
    const issue = r.error.issues[0];
    dropped.push({
      index,
      path: issue.path.join(".") || "(root)",
      code: issue.code,
      message: issue.message,
      preview: JSON.stringify(element).slice(0, 200),
    });
  });
  return { accepted, dropped };
}
