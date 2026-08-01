import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * log() + its JSON replacer — structured single-line logging.
 * The ONLY I/O edges are the clock (`new Date`) and the two byte sinks
 * (`process.stdout.write` / `process.stderr.write`); both are faked here, nothing
 * else. Every assertion parses the EXACT line that was written and checks the real
 * shape/values — never "it wrote something". Branches under test:
 *   - stream routing: debug/info → stdout, warn/error → stderr
 *   - err absent vs present; err Error vs non-Error (String(err)); err === null edge
 *   - line.message precedence: `line.message ?? e.message` (present kept, null falls back)
 *   - e.cause present → cause added; e.cause absent → cause omitted
 *   - replacer: bigint → string, Error value → {name,message,stack,cause}, default passthrough
 *   - serialize failure (circular ref) → last-ditch fallback line, routed by the ORIGINAL level
 *   - default `fields = {}`, and fields shadowing ts/level/event via spread order
 */

import { log } from "@/server/log";

const FAKE_ISO = "2020-01-01T00:00:00.000Z";

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FAKE_ISO));
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Grab the last string written to a stream spy, assert the trailing newline, return parsed JSON. */
function lastLine(spy: ReturnType<typeof vi.spyOn>): { raw: string; obj: Record<string, unknown> } {
  const call = spy.mock.calls.at(-1);
  expect(call, "expected a write to this stream").toBeDefined();
  const raw = call![0] as string;
  expect(typeof raw).toBe("string");
  expect(raw.endsWith("\n")).toBe(true);
  return { raw, obj: JSON.parse(raw) as Record<string, unknown> };
}

describe("log — stream routing + base line shape", () => {
  it("info → stdout, exact line = {ts, level, event, ...fields}; stderr untouched", () => {
    log("info", "lesson.started", { userId: "u1", reqId: "r1" });

    expect(stderrSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const { obj } = lastLine(stdoutSpy);
    expect(obj).toEqual({
      ts: FAKE_ISO,
      level: "info",
      event: "lesson.started",
      userId: "u1",
      reqId: "r1",
    });
  });

  it("debug (the else branch) → stdout", () => {
    log("debug", "probe");
    expect(stderrSpy).not.toHaveBeenCalled();
    const { obj } = lastLine(stdoutSpy);
    expect(obj).toEqual({ ts: FAKE_ISO, level: "debug", event: "probe" });
  });

  it("warn → stderr, not stdout", () => {
    log("warn", "slow.query", { canvasId: "c9" });
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const { obj } = lastLine(stderrSpy);
    expect(obj).toEqual({ ts: FAKE_ISO, level: "warn", event: "slow.query", canvasId: "c9" });
  });

  it("error → stderr, not stdout", () => {
    log("error", "boom");
    expect(stdoutSpy).not.toHaveBeenCalled();
    const { obj } = lastLine(stderrSpy);
    expect(obj).toEqual({ ts: FAKE_ISO, level: "error", event: "boom" });
  });

  it("default fields = {} → line has only ts/level/event", () => {
    log("info", "no.fields");
    const { obj } = lastLine(stdoutSpy);
    expect(obj).toEqual({ ts: FAKE_ISO, level: "info", event: "no.fields" });
  });

  it("fields shadow ts/level/event via spread order (real behaviour), but stream still uses the PARAM level", () => {
    // param level "info" → stdout; but fields.level overrides the serialized level value.
    log("info", "orig", { level: "shadowed", event: "shadowed-event", ts: "shadowed-ts" });
    expect(stderrSpy).not.toHaveBeenCalled();
    const { obj } = lastLine(stdoutSpy);
    expect(obj).toEqual({ ts: "shadowed-ts", level: "shadowed", event: "shadowed-event" });
  });
});

describe("log — err handling", () => {
  it("no err → no message/stack/cause keys at all", () => {
    log("info", "clean");
    const { obj } = lastLine(stdoutSpy);
    expect("message" in obj).toBe(false);
    expect("stack" in obj).toBe(false);
    expect("cause" in obj).toBe(false);
  });

  it("Error err (no cause) → message=e.message, stack=e.stack, NO cause key", () => {
    const e = new Error("db exploded");
    log("error", "db.fail", { userId: "u2" }, e);

    const { obj } = lastLine(stderrSpy);
    expect(obj.message).toBe("db exploded");
    expect(typeof obj.stack).toBe("string");
    expect((obj.stack as string).includes("db exploded")).toBe(true);
    expect("cause" in obj).toBe(false);
    expect(obj.userId).toBe("u2");
    expect(obj.event).toBe("db.fail");
  });

  it("Error err WITH cause → cause key added; nested Error cause serialized via replacer", () => {
    const inner = new Error("root disk full");
    const outer = new Error("write failed", { cause: inner });
    log("error", "write.fail", {}, outer);

    const { obj } = lastLine(stderrSpy);
    expect(obj.message).toBe("write failed");
    // replacer turns the Error cause into {name, message, stack, cause}
    const cause = obj.cause as Record<string, unknown>;
    expect(cause.name).toBe("Error");
    expect(cause.message).toBe("root disk full");
    expect(typeof cause.stack).toBe("string");
  });

  it("non-Error err (string) → wrapped: message = String(err)", () => {
    log("error", "str.fail", {}, "just a string");
    const { obj } = lastLine(stderrSpy);
    expect(obj.message).toBe("just a string");
    expect(typeof obj.stack).toBe("string"); // new Error() still has a stack
    expect("cause" in obj).toBe(false); // wrapped Error has no cause
  });

  it("non-Error err (number) → message = '42'", () => {
    log("warn", "num.fail", {}, 42);
    const { obj } = lastLine(stderrSpy);
    expect(obj.message).toBe("42");
  });

  it("non-Error err (plain object) → message = '[object Object]'", () => {
    log("warn", "obj.fail", {}, { code: 500 });
    const { obj } = lastLine(stderrSpy);
    expect(obj.message).toBe("[object Object]");
  });

  it("err === null still enters the block (null !== undefined) → message = 'null'", () => {
    log("error", "null.err", {}, null);
    const { obj } = lastLine(stderrSpy);
    expect(obj.message).toBe("null");
  });

  it("err === undefined behaves like no err (no message/stack)", () => {
    log("info", "undef.err", { a: 1 }, undefined);
    const { obj } = lastLine(stdoutSpy);
    expect("message" in obj).toBe(false);
    expect("stack" in obj).toBe(false);
    expect(obj.a).toBe(1);
  });
});

describe("log — line.message ?? e.message precedence", () => {
  it("fields.message present → KEPT over the error's message", () => {
    log("error", "evt", { message: "explicit override" }, new Error("errmsg"));
    const { obj } = lastLine(stderrSpy);
    expect(obj.message).toBe("explicit override");
    // stack still comes from the error
    expect((obj.stack as string).includes("errmsg")).toBe(true);
  });

  it("fields.message === null → falls back to e.message via ??", () => {
    log("error", "evt", { message: null }, new Error("errmsg wins"));
    const { obj } = lastLine(stderrSpy);
    expect(obj.message).toBe("errmsg wins");
  });
});

describe("log — replacer branches on FIELD values", () => {
  it("bigint field → serialized as its decimal string (raw BigInt would throw)", () => {
    log("info", "seq.event", { seq: BigInt("9007199254740993"), small: BigInt("10") });
    const { obj } = lastLine(stdoutSpy);
    expect(obj.seq).toBe("9007199254740993");
    expect(obj.small).toBe("10");
  });

  it("Error-valued field → {name, message, stack}; cause omitted when undefined", () => {
    log("info", "with.error.field", { failure: new TypeError("bad shape") });
    const { obj } = lastLine(stdoutSpy);
    const failure = obj.failure as Record<string, unknown>;
    expect(failure.name).toBe("TypeError");
    expect(failure.message).toBe("bad shape");
    expect(typeof failure.stack).toBe("string");
    expect("cause" in failure).toBe(false);
  });

  it("default passthrough: nested plain objects/arrays kept verbatim", () => {
    log("info", "nested", { obj: { a: [1, 2, { b: true }] }, s: "x", n: 3, bool: false });
    const { obj } = lastLine(stdoutSpy);
    expect(obj.obj).toEqual({ a: [1, 2, { b: true }] });
    expect(obj.s).toBe("x");
    expect(obj.n).toBe(3);
    expect(obj.bool).toBe(false);
  });
});

describe("log — serialize failure (last-ditch fallback)", () => {
  it("circular field at info level → fallback line, routed to stdout by the ORIGINAL level", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    log("info", "orig.event", { circular });

    expect(stderrSpy).not.toHaveBeenCalled(); // original level was info → stdout, even though fallback level is "error"
    const { obj } = lastLine(stdoutSpy);
    expect(obj).toEqual({
      ts: FAKE_ISO,
      level: "error",
      event: "log.serialize_failed",
      origEvent: "orig.event",
      message: expect.stringMatching(/circular/i),
    });
  });

  it("circular field at error level → fallback line routed to stderr", () => {
    const circular: Record<string, unknown> = {};
    circular.loop = circular;

    log("error", "handler.crash", { circular });

    expect(stdoutSpy).not.toHaveBeenCalled();
    const { obj } = lastLine(stderrSpy);
    expect(obj.event).toBe("log.serialize_failed");
    expect(obj.origEvent).toBe("handler.crash");
    expect(obj.level).toBe("error");
    expect(obj.message).toEqual(expect.stringMatching(/circular/i));
    // fallback line carries ONLY these keys — nothing leaked from the unserializable line
    expect(Object.keys(obj).sort()).toEqual(["event", "level", "message", "origEvent", "ts"]);
  });
});
