import { describe, it, expect } from "vitest";

import { extractStatements } from "@/server/advisors/knowledge/extractStatements";
import { statementsPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * extractStatements (§12.4 pass 2). The ONLY I/O edge — the JSON model call — is the INJECTED
 * `invoke` parameter (JsonInvoke), so it is faked directly with fixture JSON (the module's own
 * doc: "A test passes a fake returning fixture JSON"). `statementsPrompt` and `advise` are PURE
 * logic and run FOR REAL. Every assertion names the exact result, never "returned something":
 *   - wiring: invoke receives EXACTLY statementsPrompt(chunk, names, hint).{system,user}, once
 *   - user is the raw chunk verbatim; system carries entityNames + hint
 *   - the `entityNames.join(", ") || "(none yet)"` branch: [] → "(none yet)", non-empty → joined
 *   - default hint "" (no hint line) vs a provided hint (line injected) — the prompt's `hint ?` ternary
 *   - the `statements ?? []` branch: present array/object/scalar forwarded verbatim (by reference);
 *     missing / null / undefined → a fresh []; falsy-but-present (0, "", false) PROVES `??` not `||`
 *   - the advise() wrapper shape { __brand:"advice", raw }
 *   - invoke rejection propagates (no swallow, no fallback advice, no retry in this module)
 */

/** A fake JsonInvoke — the narrow I/O boundary. Records its args, returns fixture `data`. */
function makeInvoke(data: Record<string, unknown>): {
  invoke: JsonInvoke;
  calls: Array<{ system: string; user: string }>;
} {
  const calls: Array<{ system: string; user: string }> = [];
  const invoke: JsonInvoke = async (system, user) => {
    calls.push({ system, user });
    return { raw: JSON.stringify(data), data };
  };
  return { invoke, calls };
}

const CHUNK =
  "Every composite number can be factorised as a product of primes, and this factorisation is unique.";
const NAMES = ["Fundamental Theorem of Arithmetic", "prime factorisation"];

/** A well-formed statement, matching the shape the real prompt asks for. */
const STMT = {
  form: "DEFINITIONAL",
  kind: "DEFINITION",
  subject: "Fundamental Theorem of Arithmetic",
  predicate: "states",
  text: "Every composite number breaks down into primes.",
  quote: "every composite number can be factorised as a product of primes",
  structure: {},
};

describe("extractStatements — prompt wiring (delegates to statementsPrompt, forwards to invoke)", () => {
  it("forwards EXACTLY statementsPrompt(chunk, names, hint).{system,user} to invoke, exactly once", async () => {
    const { invoke, calls } = makeInvoke({ statements: [STMT] });

    await extractStatements(CHUNK, NAMES, invoke, "FOCUS_FTA");

    const expected = statementsPrompt(CHUNK, NAMES, "FOCUS_FTA");
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(expected.system);
    expect(calls[0].user).toBe(expected.user);
    // user is the raw chunk verbatim (not the system, not swapped)
    expect(calls[0].user).toBe(CHUNK);
  });

  it("entityNames are joined into the system prompt (the `join(\", \")` truthy branch)", async () => {
    const { invoke, calls } = makeInvoke({ statements: [] });

    await extractStatements(CHUNK, NAMES, invoke);

    expect(calls[0].system).toBe(statementsPrompt(CHUNK, NAMES).system);
    expect(calls[0].system.includes(
      "Known concepts: Fundamental Theorem of Arithmetic, prime factorisation.",
    )).toBe(true);
    expect(calls[0].system.includes("(none yet)")).toBe(false);
  });

  it("empty entityNames → \"(none yet)\" (the `|| \"(none yet)\"` fallback branch)", async () => {
    const { invoke, calls } = makeInvoke({ statements: [] });

    await extractStatements(CHUNK, [], invoke);

    expect(calls[0].system).toBe(statementsPrompt(CHUNK, []).system);
    expect(calls[0].system.includes("Known concepts: (none yet).")).toBe(true);
  });
});

describe("extractStatements — statements extraction + `?? []` fallback", () => {
  it("present statements array → advise wraps the SAME array by reference; exact wrapper shape", async () => {
    const statements = [STMT];
    const { invoke } = makeInvoke({ statements });

    const res = await extractStatements(CHUNK, NAMES, invoke);

    expect(res).toEqual({ __brand: "advice", raw: statements });
    expect(res.raw).toBe(statements); // forwarded verbatim, not copied/cloned
    expect(res.__brand).toBe("advice");
  });

  it("missing `statements` key → a fresh [] (advise([]))", async () => {
    const { invoke } = makeInvoke({}); // no statements property at all

    const res = await extractStatements(CHUNK, NAMES, invoke);

    expect(res.raw).toEqual([]);
    expect(Array.isArray(res.raw)).toBe(true);
    expect(res.__brand).toBe("advice");
  });

  it("statements: null → [] (nullish coalescing catches null)", async () => {
    const { invoke } = makeInvoke({ statements: null });

    const res = await extractStatements(CHUNK, NAMES, invoke);

    expect(res.raw).toEqual([]);
  });

  it("statements: undefined (present key) → []", async () => {
    const { invoke } = makeInvoke({ statements: undefined });

    const res = await extractStatements(CHUNK, NAMES, invoke);

    expect(res.raw).toEqual([]);
  });

  it("present EMPTY array [] is NOT replaced by the fallback (same reference kept)", async () => {
    const empty: unknown[] = [];
    const { invoke } = makeInvoke({ statements: empty });

    const res = await extractStatements(CHUNK, NAMES, invoke);

    // proves the model's [] is forwarded, not swapped for the module's literal `[]`
    expect(res.raw).toBe(empty);
  });

  it("statements: false is forwarded — `??` keeps it (`||` would wrongly yield [])", async () => {
    const { invoke } = makeInvoke({ statements: false });

    const res = await extractStatements(CHUNK, NAMES, invoke);

    expect(res.raw).toBe(false);
  });

  it("statements: 0 is forwarded (falsy-but-present, so `??` keeps it)", async () => {
    const { invoke } = makeInvoke({ statements: 0 });

    const res = await extractStatements(CHUNK, NAMES, invoke);

    expect(res.raw).toBe(0);
  });

  it("statements: '' is forwarded (falsy-but-present, so `??` keeps it)", async () => {
    const { invoke } = makeInvoke({ statements: "" });

    const res = await extractStatements(CHUNK, NAMES, invoke);

    expect(res.raw).toBe("");
  });

  it("non-array truthy statements forwarded verbatim (advisor does NOT validate — knowledge side does)", async () => {
    const weird = { not: "an array" };
    const { invoke } = makeInvoke({ statements: weird });

    const res = await extractStatements(CHUNK, NAMES, invoke);

    expect(res.raw).toBe(weird);
  });

  it("extra `data` keys are ignored; ONLY `statements` is read", async () => {
    const statements = [STMT];
    const { invoke } = makeInvoke({ statements, entities: [1, 2], foo: "bar" });

    const res = await extractStatements(CHUNK, NAMES, invoke);

    expect(res.raw).toBe(statements);
  });
});

describe("extractStatements — hint default-param branch (via the real prompt's `hint ?` ternary)", () => {
  const MARKER = "HINT_MARKER: prioritise number-theory assertions";

  it("no hint arg → default '' → no hint line; system === statementsPrompt(chunk, names).system", async () => {
    const { invoke, calls } = makeInvoke({ statements: [] });

    await extractStatements(CHUNK, NAMES, invoke); // fourth arg omitted → default ""

    expect(calls[0].system).toBe(statementsPrompt(CHUNK, NAMES).system);
    expect(calls[0].system).toBe(statementsPrompt(CHUNK, NAMES, "").system);
    expect(calls[0].system.includes(MARKER)).toBe(false);
  });

  it("explicit '' hint behaves identically to the default (falsy branch of the ternary)", async () => {
    const { invoke, calls } = makeInvoke({ statements: [] });

    await extractStatements(CHUNK, NAMES, invoke, "");

    expect(calls[0].system).toBe(statementsPrompt(CHUNK, NAMES, "").system);
    expect(calls[0].system.includes(MARKER)).toBe(false);
  });

  it("provided hint is injected into the system prompt (truthy branch) and differs from no-hint", async () => {
    const { invoke, calls } = makeInvoke({ statements: [] });

    await extractStatements(CHUNK, NAMES, invoke, MARKER);

    expect(calls[0].system).toBe(statementsPrompt(CHUNK, NAMES, MARKER).system);
    expect(calls[0].system.includes(MARKER)).toBe(true);
    expect(calls[0].system).not.toBe(statementsPrompt(CHUNK, NAMES, "").system);
  });
});

describe("extractStatements — edge chunk + failure propagation", () => {
  it("empty chunkText → user is '' and statements still forwarded", async () => {
    const statements = [STMT];
    const { invoke, calls } = makeInvoke({ statements });

    const res = await extractStatements("", NAMES, invoke, "");

    expect(calls[0].user).toBe("");
    expect(res.raw).toBe(statements);
  });

  it("invoke rejection propagates (no swallow, no fallback advice)", async () => {
    const invoke: JsonInvoke = async () => {
      throw new Error("model down");
    };

    await expect(extractStatements(CHUNK, NAMES, invoke)).rejects.toThrow("model down");
  });
});
