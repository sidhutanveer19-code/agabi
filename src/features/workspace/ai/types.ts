/**
 * AI Teaching — frontend contract.
 *
 * Everything the workspace needs to render a streamed, block-based lesson,
 * independent of who produces it. A mock provider drives it today; the Phase-6
 * backend implements the SAME `TeachingProvider` interface — no UI change.
 */

/** Subtle status surfaced to the student while the AI teaches. */
export type TeachStatus =
  | "idle"
  | "thinking"
  | "planning"
  | "generating"
  | "visualizing"
  | "finished"
  | "retrying"
  | "cancelled"
  | "error";

/** What the student asked for. */
export interface TeachRequest {
  kind: "lesson" | "command" | "question";
  topic: string;
  /** command id (again/simpler/harder/example/why/how/whatif/continue/visual…). */
  command?: string;
  /** free-text question. */
  text?: string;
}

/** One block the AI decided to teach with. `streamText` fills in token-by-token. */
export interface PlannedBlock {
  type: string;
  data: unknown;
  height: number;
  /** For text blocks: the body streamed word-by-word (data is patched as it fills). */
  streamText?: string;
}

/** A single event in the teaching stream. */
export type TeachEvent =
  | { t: "status"; status: TeachStatus }
  | { t: "region"; title: string }
  | { t: "block"; block: PlannedBlock }
  | { t: "patch"; index: number; data: unknown }
  | { t: "done" }
  | { t: "error"; recoverable: boolean; message: string };

/**
 * The teaching provider — the single seam Phase 6 swaps. `teach` returns an async
 * stream of events; `signal` cancels it (interrupt / new request supersedes).
 */
export interface TeachingProvider {
  teach(req: TeachRequest, signal: AbortSignal): AsyncIterable<TeachEvent>;
}
