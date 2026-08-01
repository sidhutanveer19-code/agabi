import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "@/features/workspace/utils/debounce";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("debounce — trailing edge", () => {
  it("fires once after the quiet period, with the latest args", () => {
    const fn = vi.fn();
    const d = debounce(fn, 400);
    d(1);
    d(2);
    d(3);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it("flush fires the pending call immediately and only once", () => {
    const fn = vi.fn();
    const d = debounce(fn, 400);
    d("x");
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith("x");
    vi.advanceTimersByTime(400); // the original timer must not fire again
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing pending is a no-op", () => {
    const fn = vi.fn();
    const d = debounce(fn, 400);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it("cancel drops the pending call", () => {
    const fn = vi.fn();
    const d = debounce(fn, 400);
    d("x");
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("debounce — maxWait (the autosave-during-stream fix)", () => {
  // THE BUG: a continuous stream of calls closer together than `ms` resets the
  // trailing timer forever, so a plain debounce NEVER fires mid-stream. This is
  // the exact reason a taught canvas was never persisted (blocks stream < 400ms apart).
  it("WITHOUT maxWait, calls arriving faster than `ms` never fire (the data-loss bug)", () => {
    const fn = vi.fn();
    const d = debounce(fn, 400);
    for (let i = 0; i < 20; i++) {
      d(i);
      vi.advanceTimersByTime(300); // < 400ms apart, like streamed blocks
    }
    expect(fn).not.toHaveBeenCalled(); // 6s of continuous activity, ZERO saves
  });

  // THE FIX: maxWait guarantees a run within maxWait even under the same stream.
  it("WITH maxWait, a continuous stream fires at least every maxWait ms", () => {
    const fn = vi.fn();
    const d = debounce(fn, 400, 2000);
    for (let i = 0; i < 20; i++) {
      d(i);
      vi.advanceTimersByTime(300); // 6s total
    }
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2); // ~every 2s over 6s
  });

  it("maxWait forces a fire under continuous (< ms) calls, with the latest args", () => {
    const fn = vi.fn();
    const d = debounce(fn, 400, 1000);
    d("a");
    vi.advanceTimersByTime(300); // t=300 — trailing timer keeps resetting (< 400)
    d("b");
    vi.advanceTimersByTime(300); // t=600
    d("c");
    vi.advanceTimersByTime(300); // t=900
    d("d");
    vi.advanceTimersByTime(100); // t=1000 → maxWait (armed at t=0) fires with latest "d"
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith("d");
  });

  it("after a maxWait fire, a fresh stream arms maxWait again and fires again", () => {
    const fn = vi.fn();
    const d = debounce(fn, 400, 1000);
    // first continuous stream → maxWait fires ~t=1000 with "d"
    d("a"); vi.advanceTimersByTime(300);
    d("b"); vi.advanceTimersByTime(300);
    d("c"); vi.advanceTimersByTime(300);
    d("d"); vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    // second continuous stream → maxWait must re-arm and fire again with "h"
    d("e"); vi.advanceTimersByTime(300);
    d("f"); vi.advanceTimersByTime(300);
    d("g"); vi.advanceTimersByTime(300);
    d("h"); vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("h");
  });

  it("a quiet burst shorter than maxWait still fires on the trailing edge", () => {
    const fn = vi.fn();
    const d = debounce(fn, 400, 2000);
    d("x");
    vi.advanceTimersByTime(400); // trailing edge fires before maxWait
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith("x");
    vi.advanceTimersByTime(2000); // stale maxTimer must not double-fire
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
