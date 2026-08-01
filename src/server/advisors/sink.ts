// @no-test-ok: pure TYPE declaration (interface ChunkSink) — no runtime logic to test; its
// behaviour (onText/onSlot/onError) is exercised for real in chunk.test.ts + manager.test.ts.
/**
 * The streaming channel from the chunk advisor back to production. Declared HERE
 * (advisors own it) so `advisors/chunk.ts` never imports from `conversation/` —
 * the dependency is one-directional in both the type graph and the import test.
 * `conversation/` IMPLEMENTS this (turning calls into `patch` writes); the advisor
 * only calls it. The advisor never writes to a stream or a database itself.
 */
export interface ChunkSink {
  /** A text slot's accumulated prose so far (word-by-word streaming). */
  onText(index: number, fullText: string): void;
  /** A visual slot's raw payload (one-shot JSON / tool call). */
  onSlot(index: number, payload: unknown): void;
  /**
   * A provider attempt THREW (tool-call rejected, HTTP/auth/429, timeout, …). Reported
   * LOUD so production can emit it as evidence and never silently degrade (Law 11 — the
   * bug where a failed Groq tool-call was swallowed and the lesson silently fell to a
   * toy model). Optional so pure advisor tests need not implement it. The advisor still
   * falls through to the next provider after reporting.
   */
  onError?(providerName: string, error: unknown): void;
}
