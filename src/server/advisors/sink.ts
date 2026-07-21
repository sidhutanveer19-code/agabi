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
}
