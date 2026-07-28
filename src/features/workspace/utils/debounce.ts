/**
 * Trailing-edge debounce with `cancel` + `flush`, used by autosave so rapid
 * camera/doc changes collapse into a single write.
 *
 * `maxWait` (optional): the longest the call may be deferred under a CONTINUOUS
 * stream of calls. Without it, a trailing debounce whose calls arrive closer
 * together than `ms` resets its timer forever and NEVER fires — exactly what
 * happened to workspace autosave during a lesson stream (blocks arrive < 400ms
 * apart), so a taught canvas was never persisted until React unmount. `maxWait`
 * guarantees a run at least every `maxWait` ms even mid-stream.
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel: () => void;
  flush: () => void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  maxWait?: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const run = () => {
    if (timer) clearTimeout(timer);
    if (maxTimer) clearTimeout(maxTimer);
    timer = null;
    maxTimer = null;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
    if (maxWait != null && maxTimer == null) {
      maxTimer = setTimeout(run, maxWait);
    }
  }) as Debounced<A>;

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    if (maxTimer) clearTimeout(maxTimer);
    timer = null;
    maxTimer = null;
    lastArgs = null;
  };

  debounced.flush = () => {
    if (lastArgs) run();
  };

  return debounced;
}
