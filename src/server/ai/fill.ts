/**
 * The incremental in-order flush cursor. Slots resolve out of order (the batch
 * model fills whichever it likes; retries land later) but MUST emit in slot order
 * 1..N — heading first, summary last. `place(n, block)` queues a resolved slot;
 * everything from the cursor forward that is ready flushes immediately, then it
 * stops at the first gap. A slot placed twice is ignored (first content wins).
 *
 * Pure and deterministic — the route's RUNG-5 forcing (head-of-line / budget)
 * calls the SAME `place`, so forced blocks flush in order too. Timing (the 20s /
 * 120s deadlines) lives in the route; this is only the ordering guarantee.
 */
export interface FilledBlock {
  type: string;
  data: Record<string, unknown>;
  streamText?: string;
}

export class OrderedFiller {
  private queued = new Map<number, FilledBlock>();
  private settledSet = new Set<number>();
  private cursor = 1;

  constructor(
    private readonly onEmit: (block: FilledBlock) => Promise<void> | void,
    private readonly onAdvance?: () => void,
  ) {}

  /** Slot number the queue is currently waiting on (1..N, then N+1 when done). */
  get next(): number {
    return this.cursor;
  }

  /** Blocks emitted so far. */
  get emitted(): number {
    return this.cursor - 1;
  }

  settled(n: number): boolean {
    return this.settledSet.has(n);
  }

  /** Queue slot `n`; flush every ready slot from the cursor forward, in order. */
  async place(n: number, block: FilledBlock): Promise<void> {
    if (this.settledSet.has(n)) return; // first content for a slot wins
    this.settledSet.add(n);
    this.queued.set(n, block);
    while (this.queued.has(this.cursor)) {
      const b = this.queued.get(this.cursor)!;
      this.queued.delete(this.cursor);
      await this.onEmit(b);
      this.cursor++;
      this.onAdvance?.();
    }
  }
}
