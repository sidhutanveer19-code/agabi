import { describe, it, expect } from "vitest";

import { extractAssets } from "@/server/advisors/knowledge/extractAssets";
import { assetsPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * extractAssets (Pass 4, §12.4). The ONE I/O edge — the model call — is injected as
 * `invoke: JsonInvoke`, so it is faked directly (the module's designed test seam); nothing
 * is mocked away. Everything asserted here is the module's OWN behaviour, exercised for real:
 *   - it builds the prompt with the REAL `assetsPrompt(chunkText, entityNames)` and forwards
 *     that system/user pair to `invoke` verbatim, exactly once;
 *   - it unwraps `data.assets` and returns REAL `advise(...)` — the branded, unvalidated wrapper;
 *   - the sole branch, `data.assets ?? []`, is proven on BOTH sides, including that it is `??`
 *     (nullish) and NOT `||` (falsy) — a defined-but-falsy `assets` must pass through unchanged.
 * Adversarial: missing key, null, undefined, 0/""/false, non-array shapes, a rejecting invoke,
 * and a contract-violating null `data` (the module has no guard — it must throw, not silently []).
 */

/** A fake JsonInvoke that records what it was called with and returns the given parsed `data`.
 *  `data` is returned BY REFERENCE, so `result.raw` reference-identity is checkable. */
function recordingInvoke(data: Record<string, unknown>) {
  const calls: Array<{ system: string; user: string }> = [];
  const invoke: JsonInvoke = async (system, user) => {
    calls.push({ system, user });
    return { raw: JSON.stringify(data ?? null), data };
  };
  return { invoke, calls };
}

const CHUNK = "A boy 15 m from a tower sees its top at 60 degrees. Use the tangent ratio.";
const NAMES = ["tangent ratio", "angle of elevation"];

describe("extractAssets — prompt wiring (real assetsPrompt, forwarded verbatim)", () => {
  it("calls invoke exactly once with the EXACT assetsPrompt(chunkText, entityNames) system+user", async () => {
    const { invoke, calls } = recordingInvoke({ assets: [] });
    await extractAssets(CHUNK, NAMES, invoke);

    const expected = assetsPrompt(CHUNK, NAMES);
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(expected.system);
    expect(calls[0].user).toBe(expected.user);
    // Concrete facts, so the assertion still means something independent of assetsPrompt:
    expect(calls[0].user).toBe(CHUNK); // assetsPrompt puts the chunk verbatim into `user`
    expect(calls[0].system).toContain("Known concepts: tangent ratio, angle of elevation.");
    expect(calls[0].system).toContain('"kind": "MISCONCEPTION"|"ANALOGY"|"WORKED_EXAMPLE"');
  });

  it("empty entityNames → the '(none yet)' fallback branch inside the forwarded prompt", async () => {
    const { invoke, calls } = recordingInvoke({ assets: [] });
    await extractAssets(CHUNK, [], invoke);
    expect(calls[0].system).toContain("Known concepts: (none yet).");
    expect(calls[0].system).not.toContain("Known concepts: .");
  });
});

describe("extractAssets — assets present (left side of `??`)", () => {
  it("array assets → advise wraps the EXACT same array reference, brand is 'advice'", async () => {
    const assets = [
      { kind: "MISCONCEPTION", conceptName: "tangent ratio", payload: { misconception: "x", correction: "y" } },
      { kind: "WORKED_EXAMPLE", conceptName: "angle of elevation", payload: { problem: "p", steps: ["s"], answer: "a" } },
    ];
    const { invoke } = recordingInvoke({ assets });

    const result = await extractAssets(CHUNK, NAMES, invoke);
    expect(result.__brand).toBe("advice");
    expect(result.raw).toBe(assets); // no copy, no transform — identical reference
    expect(result.raw).toEqual(assets);
    // advise wraps ONLY brand + raw; nothing else leaks.
    expect(Object.keys(result).sort()).toEqual(["__brand", "raw"]);
  });

  it("non-array truthy assets (object) → forwarded as-is; module does NOT coerce to an array", async () => {
    const weird = { not: "an array" };
    const { invoke } = recordingInvoke({ assets: weird });
    const result = await extractAssets(CHUNK, NAMES, invoke);
    expect(result.raw).toBe(weird);
  });

  it("non-array truthy assets (string) → forwarded verbatim, not wrapped in []", async () => {
    const { invoke } = recordingInvoke({ assets: "just a string" });
    const result = await extractAssets(CHUNK, NAMES, invoke);
    expect(result.raw).toBe("just a string");
  });
});

describe("extractAssets — assets nullish (right side of `??` → [])", () => {
  it("missing `assets` key → raw is a fresh empty array", async () => {
    const { invoke } = recordingInvoke({ somethingElse: 1 });
    const result = await extractAssets(CHUNK, NAMES, invoke);
    expect(result.__brand).toBe("advice");
    expect(result.raw).toEqual([]);
    expect(Array.isArray(result.raw)).toBe(true);
  });

  it("assets === null → raw is []", async () => {
    const { invoke } = recordingInvoke({ assets: null });
    const result = await extractAssets(CHUNK, NAMES, invoke);
    expect(result.raw).toEqual([]);
  });

  it("assets === undefined (explicit) → raw is []", async () => {
    const { invoke } = recordingInvoke({ assets: undefined });
    const result = await extractAssets(CHUNK, NAMES, invoke);
    expect(result.raw).toEqual([]);
  });
});

describe("extractAssets — `??` semantics, NOT `||` (defined-but-falsy passes through)", () => {
  it("assets === 0 → raw is 0, NOT [] (would be [] if the code used ||)", async () => {
    const { invoke } = recordingInvoke({ assets: 0 });
    const result = await extractAssets(CHUNK, NAMES, invoke);
    expect(result.raw).toBe(0);
  });

  it("assets === '' → raw is '', NOT []", async () => {
    const { invoke } = recordingInvoke({ assets: "" });
    const result = await extractAssets(CHUNK, NAMES, invoke);
    expect(result.raw).toBe("");
  });

  it("assets === false → raw is false, NOT []", async () => {
    const { invoke } = recordingInvoke({ assets: false });
    const result = await extractAssets(CHUNK, NAMES, invoke);
    expect(result.raw).toBe(false);
  });
});

describe("extractAssets — error propagation + missing guard (adversarial)", () => {
  it("invoke rejects → extractAssets rejects with the SAME error (not swallowed, no advise)", async () => {
    const invoke: JsonInvoke = async () => {
      throw new Error("model down");
    };
    await expect(extractAssets(CHUNK, NAMES, invoke)).rejects.toThrow("model down");
  });

  it("data === null (contract violation) → throws TypeError; the module has NO null guard", async () => {
    const invoke: JsonInvoke = async () => ({ raw: "null", data: null as unknown as Record<string, unknown> });
    await expect(extractAssets(CHUNK, NAMES, invoke)).rejects.toThrow(TypeError);
  });
});
