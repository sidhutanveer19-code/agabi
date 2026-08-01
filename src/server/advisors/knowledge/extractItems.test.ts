import { describe, it, expect } from "vitest";

import { extractItems } from "@/server/advisors/knowledge/extractItems";
import { itemsPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";
import type { Advice } from "@/server/advisors/advice";

/**
 * extractItems (M9) — proposes assessment items over known concepts.
 * The ONLY I/O edge is the injected `JsonInvoke` (a model call); it is faked here as a
 * plain in-memory function, so `itemsPrompt` (prompt assembly) and `advise` (the trust-
 * boundary wrap) run FOR REAL. Every assertion names the exact output value.
 *
 * The one branch in the module is `(data.items) ?? []`. It is pinned from both sides and
 * hardened against the `||` mistake (falsy-but-present values MUST survive `??`), plus the
 * exact prompt wiring, the ignored `raw` field, and error propagation.
 */

/** A fake model call that records the (system, user) it was handed and returns fixed `data`. */
function recordingInvoke(
  data: Record<string, unknown>,
  raw = "{}",
): { invoke: JsonInvoke; calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  const invoke: JsonInvoke = async (system, user) => {
    calls.push({ system, user });
    return { raw, data };
  };
  return { invoke, calls };
}

describe("extractItems — happy path (items present)", () => {
  it("forwards the model's items array VERBATIM, wrapped as branded advice", async () => {
    const items = [
      { kind: "MCQ", conceptName: "prime factorisation", prompt: "Which number is prime?", payload: { options: [] } },
      { kind: "SHORT", conceptName: "HCF", prompt: "Define the HCF of two numbers.", payload: {} },
    ];
    const { invoke } = recordingInvoke({ items });

    const res: Advice<unknown> = await extractItems("chunk", ["prime factorisation", "HCF"], invoke);

    expect(res.__brand).toBe("advice");
    // no copy, no validation, no re-shaping in this layer — the SAME array reference comes back out.
    expect(res.raw).toBe(items);
    // advise() returns exactly { __brand, raw } and nothing else.
    expect(Object.keys(res).sort()).toEqual(["__brand", "raw"]);
  });

  it("a single-item array is passed through unchanged", async () => {
    const { invoke } = recordingInvoke({ items: [{ kind: "NUMERIC", conceptName: "area", prompt: "Area?", payload: {} }] });
    const res = await extractItems("c", ["area"], invoke);
    expect(res.raw).toEqual([{ kind: "NUMERIC", conceptName: "area", prompt: "Area?", payload: {} }]);
  });
});

describe("extractItems — the `?? []` default branch", () => {
  it("data has NO items key → raw defaults to a fresh empty array", async () => {
    const { invoke } = recordingInvoke({});
    const res = await extractItems("chunk", ["c"], invoke);
    expect(res.__brand).toBe("advice");
    expect(Array.isArray(res.raw)).toBe(true);
    expect(res.raw).toEqual([]);
  });

  it("items === null → nullish-coalesces to empty array", async () => {
    const { invoke } = recordingInvoke({ items: null });
    const res = await extractItems("chunk", ["c"], invoke);
    expect(res.raw).toEqual([]);
  });

  it("items === undefined → empty array", async () => {
    const { invoke } = recordingInvoke({ items: undefined });
    const res = await extractItems("chunk", ["c"], invoke);
    expect(res.raw).toEqual([]);
  });
});

describe("extractItems — `??` NOT `||` (falsy-but-present values survive)", () => {
  it("items === 0 is KEPT (|| would have replaced it with [])", async () => {
    const { invoke } = recordingInvoke({ items: 0 });
    const res = await extractItems("c", ["c"], invoke);
    expect(res.raw).toBe(0);
  });

  it('items === "" is KEPT', async () => {
    const { invoke } = recordingInvoke({ items: "" });
    const res = await extractItems("c", ["c"], invoke);
    expect(res.raw).toBe("");
  });

  it("items === false is KEPT", async () => {
    const { invoke } = recordingInvoke({ items: false });
    const res = await extractItems("c", ["c"], invoke);
    expect(res.raw).toBe(false);
  });

  it("an EMPTY array is forwarded as the SAME reference, not swapped for the default []", async () => {
    const items: unknown[] = [];
    const { invoke } = recordingInvoke({ items });
    const res = await extractItems("c", ["c"], invoke);
    expect(res.raw).toBe(items); // truthy + non-nullish → left side of `??`
  });

  it("a non-array items value is forwarded verbatim (shape validation happens later, not here)", async () => {
    const weird = { not: "an array" };
    const { invoke } = recordingInvoke({ items: weird });
    const res = await extractItems("c", ["c"], invoke);
    expect(res.raw).toBe(weird);
  });
});

describe("extractItems — prompt wiring into invoke", () => {
  it("calls invoke EXACTLY once with itemsPrompt(chunkText, entityNames).system/user", async () => {
    const chunk = "A composite number can be factorised into primes; the factorisation is unique.";
    const names = ["prime factorisation", "HCF"];
    const { invoke, calls } = recordingInvoke({ items: [] });

    await extractItems(chunk, names, invoke);

    const expected = itemsPrompt(chunk, names);
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(expected.system);
    expect(calls[0].user).toBe(expected.user);
    // sanity on what those strings actually are: user is the raw chunk; system lists the concepts.
    expect(calls[0].user).toBe(chunk);
    expect(calls[0].system).toContain("Known concepts: prime factorisation, HCF.");
  });

  it("empty entityNames → the prompt lists '(none yet)' and extraction still returns advice", async () => {
    const { invoke, calls } = recordingInvoke({ items: [{ kind: "SHORT", conceptName: "x", prompt: "p", payload: {} }] });

    const res = await extractItems("some chunk text", [], invoke);

    expect(calls[0].system).toContain("Known concepts: (none yet).");
    expect(res.raw).toEqual([{ kind: "SHORT", conceptName: "x", prompt: "p", payload: {} }]);
  });

  it("ignores the invoke result's `raw` string — only data.items drives the output", async () => {
    const { invoke } = recordingInvoke({ items: [1, 2] }, "TOTALLY DIFFERENT RAW TEXT");
    const res = await extractItems("c", ["c"], invoke);
    expect(res.raw).toEqual([1, 2]);
  });
});

describe("extractItems — async + failure propagation", () => {
  it("awaits the invoke promise before wrapping the result", async () => {
    const slow: JsonInvoke = () =>
      new Promise((resolve) => setTimeout(() => resolve({ raw: "{}", data: { items: ["late"] } }), 5));
    const res = await extractItems("c", ["c"], slow);
    expect(res.raw).toEqual(["late"]);
  });

  it("propagates an invoke rejection unchanged (no try/catch swallowing)", async () => {
    const boom: JsonInvoke = async () => {
      throw new Error("model down");
    };
    await expect(extractItems("c", ["c"], boom)).rejects.toThrow("model down");
  });
});
