import { describe, it, expect } from "vitest";

import { extractDependencies } from "@/server/advisors/knowledge/extractDependencies";
import { dependenciesPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * extractDependencies (Pass 3, §12.4). The ONE I/O edge — the model call — is injected as
 * `invoke: JsonInvoke`, the module's designed test seam, so it is faked directly; nothing is
 * mocked away. `dependenciesPrompt` and `advise` are PURE logic and run FOR REAL. Every
 * assertion names the exact result, never "returned something". Branches under test:
 *   - wiring: invoke receives EXACTLY dependenciesPrompt(chunk, entityNames).{system,user}, once;
 *   - the '(none yet)' vs joined-names fallback inside the forwarded prompt (entityNames branch);
 *   - the sole module branch, `data.dependencies ?? []`, proven on BOTH sides, INCLUDING that it
 *     is `??` (nullish) and NOT `||` (falsy) — a defined-but-falsy value must pass through;
 *   - the advise() wrapper shape { __brand:"advice", raw } (unvalidated — the DAG is human-confirmed
 *     downstream, so a non-array/garbage classification is forwarded, never coerced);
 *   - it destructures `data`, ignoring the sibling `raw` string;
 *   - a rejecting invoke propagates (no swallow, no fallback advice, no retry here);
 *   - a contract-violating null `data` — the module has NO guard, so it must throw, not silently [].
 */

/** A fake JsonInvoke that records its args and returns the given parsed `data`. `data` is returned
 *  BY REFERENCE, so `result.raw` reference-identity is checkable. */
function recordingInvoke(data: Record<string, unknown>) {
  const calls: Array<{ system: string; user: string }> = [];
  const invoke: JsonInvoke = async (system, user) => {
    calls.push({ system, user });
    return { raw: JSON.stringify(data ?? null), data };
  };
  return { invoke, calls };
}

const CHUNK =
  "Every composite number can be written as a product of primes; this factorisation is unique.";
const NAMES = ["prime factorisation", "Fundamental Theorem of Arithmetic"];

describe("extractDependencies — prompt wiring (real dependenciesPrompt, forwarded verbatim)", () => {
  it("calls invoke exactly once with the EXACT dependenciesPrompt(chunkText, entityNames) system+user", async () => {
    const { invoke, calls } = recordingInvoke({ dependencies: [] });
    await extractDependencies(CHUNK, NAMES, invoke);

    const expected = dependenciesPrompt(CHUNK, NAMES);
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(expected.system);
    expect(calls[0].user).toBe(expected.user);
    // Concrete facts, so the assertion still means something independent of dependenciesPrompt:
    expect(calls[0].user).toBe(CHUNK); // dependenciesPrompt puts the chunk verbatim into `user`
    expect(calls[0].system).toContain(
      "Known concepts: prime factorisation, Fundamental Theorem of Arithmetic.",
    );
    expect(calls[0].system).toContain("propose relationships between the known concepts");
    expect(calls[0].system).toContain(
      '"classification": "REQUIRES"|"PART_OF"|"REINFORCEMENT"',
    );
  });

  it("empty entityNames → the '(none yet)' fallback branch inside the forwarded prompt", async () => {
    const { invoke, calls } = recordingInvoke({ dependencies: [] });
    await extractDependencies(CHUNK, [], invoke);

    expect(calls[0].system).toBe(dependenciesPrompt(CHUNK, []).system);
    expect(calls[0].system).toContain("Known concepts: (none yet).");
    expect(calls[0].system).not.toContain("Known concepts: .");
  });
});

describe("extractDependencies — dependencies present (left side of `??`)", () => {
  it("array of dependencies → advise wraps the EXACT same array reference; brand 'advice'; payload intact", async () => {
    const dependencies = [
      { fromName: "prime factorisation", toName: "Fundamental Theorem of Arithmetic", classification: "REQUIRES" },
      { fromName: "Fundamental Theorem of Arithmetic", toName: "prime factorisation", classification: "PART_OF", type: "structural" },
      { fromName: "HCF", toName: "LCM", classification: "REINFORCEMENT" },
    ];
    const { invoke } = recordingInvoke({ dependencies });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.__brand).toBe("advice");
    expect(result.raw).toBe(dependencies); // no copy, no transform — identical reference
    expect(result.raw).toEqual(dependencies);
    // The real classified payload is forwarded untouched (validation is downstream, human-confirmed).
    expect(result.raw).toEqual([
      { fromName: "prime factorisation", toName: "Fundamental Theorem of Arithmetic", classification: "REQUIRES" },
      { fromName: "Fundamental Theorem of Arithmetic", toName: "prime factorisation", classification: "PART_OF", type: "structural" },
      { fromName: "HCF", toName: "LCM", classification: "REINFORCEMENT" },
    ]);
    // advise wraps ONLY brand + raw; nothing else leaks.
    expect(Object.keys(result).sort()).toEqual(["__brand", "raw"]);
  });

  it("present EMPTY array [] is NOT replaced by the fallback (same reference kept)", async () => {
    const empty: unknown[] = [];
    const { invoke } = recordingInvoke({ dependencies: empty });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    // proves the model's [] is forwarded, not swapped for the module's literal `[]`
    expect(result.raw).toBe(empty);
  });

  it("non-array truthy dependencies (object) → forwarded as-is; module does NOT coerce to an array", async () => {
    const weird = { not: "an array" };
    const { invoke } = recordingInvoke({ dependencies: weird });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.raw).toBe(weird);
  });

  it("non-array truthy dependencies (string) → forwarded verbatim, not wrapped in []", async () => {
    const { invoke } = recordingInvoke({ dependencies: "just a string" });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.raw).toBe("just a string");
  });
});

describe("extractDependencies — dependencies nullish (right side of `??` → [])", () => {
  it("missing `dependencies` key → raw is a fresh empty array", async () => {
    const { invoke } = recordingInvoke({ somethingElse: 1 });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.__brand).toBe("advice");
    expect(result.raw).toEqual([]);
    expect(Array.isArray(result.raw)).toBe(true);
  });

  it("dependencies === null → raw is []", async () => {
    const { invoke } = recordingInvoke({ dependencies: null });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.raw).toEqual([]);
  });

  it("dependencies === undefined (explicit key) → raw is []", async () => {
    const { invoke } = recordingInvoke({ dependencies: undefined });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.raw).toEqual([]);
  });
});

describe("extractDependencies — `??` semantics, NOT `||` (defined-but-falsy passes through)", () => {
  it("dependencies === 0 → raw is 0, NOT [] (would be [] if the code used ||)", async () => {
    const { invoke } = recordingInvoke({ dependencies: 0 });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.raw).toBe(0);
  });

  it("dependencies === '' → raw is '', NOT []", async () => {
    const { invoke } = recordingInvoke({ dependencies: "" });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.raw).toBe("");
  });

  it("dependencies === false → raw is false, NOT []", async () => {
    const { invoke } = recordingInvoke({ dependencies: false });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.raw).toBe(false);
  });
});

describe("extractDependencies — reads `data`, ignores the sibling `raw` string", () => {
  it("only `data.dependencies` is unwrapped; the invoke's `raw` string is never used", async () => {
    const truth = [{ fromName: "a", toName: "b", classification: "REQUIRES" }];
    const invoke: JsonInvoke = async () => ({
      raw: '[{"lie":true}]', // deliberately different from `data` — must be ignored
      data: { dependencies: truth },
    });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.raw).toBe(truth); // came from `data`, not the misleading `raw` string
    expect(result.raw).not.toEqual([{ lie: true }]);
  });

  it("extra `data` keys are ignored; ONLY `dependencies` is read", async () => {
    const dependencies = [{ fromName: "x", toName: "y", classification: "PART_OF" }];
    const { invoke } = recordingInvoke({ dependencies, entities: [1, 2], foo: "bar" });

    const result = await extractDependencies(CHUNK, NAMES, invoke);

    expect(result.raw).toBe(dependencies);
  });
});

describe("extractDependencies — edge chunk + failure propagation (adversarial)", () => {
  it("empty chunkText → user is '' and dependencies still forwarded", async () => {
    const dependencies = [{ fromName: "x", toName: "y", classification: "REINFORCEMENT" }];
    const { invoke, calls } = recordingInvoke({ dependencies });

    const result = await extractDependencies("", NAMES, invoke);

    expect(calls[0].user).toBe("");
    expect(result.raw).toBe(dependencies);
  });

  it("invoke rejects → extractDependencies rejects with the SAME error (not swallowed, no advise)", async () => {
    const invoke: JsonInvoke = async () => {
      throw new Error("model down");
    };

    await expect(extractDependencies(CHUNK, NAMES, invoke)).rejects.toThrow("model down");
  });

  it("data === null (contract violation) → throws TypeError; the module has NO null guard", async () => {
    const invoke: JsonInvoke = async () => ({
      raw: "null",
      data: null as unknown as Record<string, unknown>,
    });

    await expect(extractDependencies(CHUNK, NAMES, invoke)).rejects.toThrow(TypeError);
  });
});
