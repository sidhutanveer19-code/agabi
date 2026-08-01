import { describe, it, expect } from "vitest";

import { extractEntities } from "@/server/advisors/knowledge/extractEntities";
import { entitiesPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * extractEntities (§12.4 pass 1). The ONLY I/O edge — the JSON model call — is the INJECTED
 * `invoke` parameter (JsonInvoke), so it is faked directly with fixture JSON (the module's own
 * doc: "A test passes a fake returning fixture JSON"). `entitiesPrompt` and `advise` are PURE
 * logic and run FOR REAL. Every assertion names the exact result, never "returned something":
 *   - wiring: invoke receives EXACTLY entitiesPrompt(chunk, hint).{system,user}, exactly once
 *   - default hint "" (no hint line) vs a provided hint (line injected) — the prompt's `hint ?` ternary
 *   - the `entities ?? []` branch: present array/object/scalar forwarded verbatim (by reference);
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

const CHUNK = "A boy 15 m from a tower observes the top at 60°. Use the tangent ratio.";

describe("extractEntities — prompt wiring (delegates to entitiesPrompt, forwards to invoke)", () => {
  it("forwards EXACTLY entitiesPrompt(chunk, hint).{system,user} to invoke, exactly once", async () => {
    const { invoke, calls } = makeInvoke({ entities: [{ name: "tangent ratio" }] });

    await extractEntities(CHUNK, invoke, "FOCUS_TRIG");

    const expected = entitiesPrompt(CHUNK, "FOCUS_TRIG");
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(expected.system);
    expect(calls[0].user).toBe(expected.user);
    // user is the raw chunk verbatim (not the system, not swapped)
    expect(calls[0].user).toBe(CHUNK);
  });
});

describe("extractEntities — entities extraction + `?? []` fallback", () => {
  it("present entities array → advise wraps the SAME array by reference; exact wrapper shape", async () => {
    const entities = [{ name: "tangent ratio", kind: "SKILL" }];
    const { invoke } = makeInvoke({ entities });

    const res = await extractEntities(CHUNK, invoke);

    expect(res).toEqual({ __brand: "advice", raw: entities });
    expect(res.raw).toBe(entities); // forwarded verbatim, not copied/cloned
    expect(res.__brand).toBe("advice");
  });

  it("missing `entities` key → a fresh [] (advise([]))", async () => {
    const { invoke } = makeInvoke({}); // no entities property at all

    const res = await extractEntities(CHUNK, invoke);

    expect(res.raw).toEqual([]);
    expect(Array.isArray(res.raw)).toBe(true);
    expect(res.__brand).toBe("advice");
  });

  it("entities: null → [] (nullish coalescing catches null)", async () => {
    const { invoke } = makeInvoke({ entities: null });

    const res = await extractEntities(CHUNK, invoke);

    expect(res.raw).toEqual([]);
  });

  it("entities: undefined (present key) → []", async () => {
    const { invoke } = makeInvoke({ entities: undefined });

    const res = await extractEntities(CHUNK, invoke);

    expect(res.raw).toEqual([]);
  });

  it("present EMPTY array [] is NOT replaced by the fallback (same reference kept)", async () => {
    const empty: unknown[] = [];
    const { invoke } = makeInvoke({ entities: empty });

    const res = await extractEntities(CHUNK, invoke);

    // proves the model's [] is forwarded, not swapped for the module's literal `[]`
    expect(res.raw).toBe(empty);
  });

  it("entities: false is forwarded — `??` keeps it (`||` would wrongly yield [])", async () => {
    const { invoke } = makeInvoke({ entities: false });

    const res = await extractEntities(CHUNK, invoke);

    expect(res.raw).toBe(false);
  });

  it("entities: 0 is forwarded (falsy-but-present, so `??` keeps it)", async () => {
    const { invoke } = makeInvoke({ entities: 0 });

    const res = await extractEntities(CHUNK, invoke);

    expect(res.raw).toBe(0);
  });

  it("entities: '' is forwarded (falsy-but-present, so `??` keeps it)", async () => {
    const { invoke } = makeInvoke({ entities: "" });

    const res = await extractEntities(CHUNK, invoke);

    expect(res.raw).toBe("");
  });

  it("non-array truthy entities forwarded verbatim (advisor does NOT validate — knowledge side does)", async () => {
    const weird = { not: "an array" };
    const { invoke } = makeInvoke({ entities: weird });

    const res = await extractEntities(CHUNK, invoke);

    expect(res.raw).toBe(weird);
  });

  it("extra `data` keys are ignored; ONLY `entities` is read", async () => {
    const entities = [{ name: "x" }];
    const { invoke } = makeInvoke({ entities, statements: [1, 2], foo: "bar" });

    const res = await extractEntities(CHUNK, invoke);

    expect(res.raw).toBe(entities);
  });
});

describe("extractEntities — hint default-param branch (via the real prompt's `hint ?` ternary)", () => {
  const MARKER = "HINT_MARKER: prioritise trigonometry concepts";

  it("no hint arg → default '' → no hint line; system === entitiesPrompt(chunk).system", async () => {
    const { invoke, calls } = makeInvoke({ entities: [] });

    await extractEntities(CHUNK, invoke); // third arg omitted → default ""

    expect(calls[0].system).toBe(entitiesPrompt(CHUNK).system);
    expect(calls[0].system).toBe(entitiesPrompt(CHUNK, "").system);
    expect(calls[0].system.includes(MARKER)).toBe(false);
  });

  it("explicit '' hint behaves identically to the default (falsy branch of the ternary)", async () => {
    const { invoke, calls } = makeInvoke({ entities: [] });

    await extractEntities(CHUNK, invoke, "");

    expect(calls[0].system).toBe(entitiesPrompt(CHUNK, "").system);
    expect(calls[0].system.includes(MARKER)).toBe(false);
  });

  it("provided hint is injected into the system prompt (truthy branch) and differs from no-hint", async () => {
    const { invoke, calls } = makeInvoke({ entities: [] });

    await extractEntities(CHUNK, invoke, MARKER);

    expect(calls[0].system).toBe(entitiesPrompt(CHUNK, MARKER).system);
    expect(calls[0].system.includes(MARKER)).toBe(true);
    expect(calls[0].system).not.toBe(entitiesPrompt(CHUNK, "").system);
  });
});

describe("extractEntities — edge chunk + failure propagation", () => {
  it("empty chunkText → user is '' and entities still forwarded", async () => {
    const entities = [{ name: "x" }];
    const { invoke, calls } = makeInvoke({ entities });

    const res = await extractEntities("", invoke, "");

    expect(calls[0].user).toBe("");
    expect(res.raw).toBe(entities);
  });

  it("invoke rejection propagates (no swallow, no fallback advice)", async () => {
    const invoke: JsonInvoke = async () => {
      throw new Error("model down");
    };

    await expect(extractEntities(CHUNK, invoke)).rejects.toThrow("model down");
  });
});
