import { describe, it, expect } from "vitest";
import { buildAsset } from "@/server/knowledge/teaching/asset";

/**
 * §H1 mutation coverage for teaching/asset.ts (§13, ADR-2). teaching.test.ts builds assets without
 * ever passing `statementId`, so the `input.statementId ?? null` defaulting survived (a `&& null`
 * mutant would blank a real statementId). These tests pin every field buildAsset writes, and both
 * sides of each `??` default (statementId, scope), so the produced TeachingAsset is fully anchored.
 */

const misconception = { misconception: "plants eat sunlight", correction: "they convert it" };

describe("buildAsset — statementId defaulting (kills `?? null` → `&& null`)", () => {
  it("keeps an explicitly-supplied statementId verbatim", () => {
    const { asset } = buildAsset({
      kind: "MISCONCEPTION",
      conceptId: "c1",
      statementId: "stmt-42",
      payload: misconception,
      contextId: "ctx-1",
    });
    expect(asset.statementId).toBe("stmt-42");
  });

  it("defaults a MISSING statementId to null", () => {
    const { asset } = buildAsset({ kind: "MISCONCEPTION", conceptId: "c1", payload: misconception, contextId: "ctx-1" });
    expect(asset.statementId).toBeNull();
  });

  it("defaults an explicit null statementId to null", () => {
    const { asset } = buildAsset({ kind: "MISCONCEPTION", conceptId: "c1", statementId: null, payload: misconception, contextId: "ctx-1" });
    expect(asset.statementId).toBeNull();
  });
});

describe("buildAsset — scope defaulting (kills `?? \"PUBLIC\"`)", () => {
  it("defaults an omitted scope to PUBLIC", () => {
    const { asset } = buildAsset({ kind: "MISCONCEPTION", conceptId: "c1", payload: misconception, contextId: "ctx-1" });
    expect(asset.scope).toBe("PUBLIC");
  });

  it("keeps an explicit tenant scope", () => {
    const { asset } = buildAsset({ kind: "MISCONCEPTION", conceptId: "c1", payload: misconception, contextId: "ctx-1", scope: "tenant:acme" });
    expect(asset.scope).toBe("tenant:acme");
  });
});

describe("buildAsset — every other field is pinned exactly", () => {
  it("stamps kind/conceptId/payload/contextId from the input and the fixed defaults", () => {
    const payload = { ...misconception };
    const { asset } = buildAsset({
      kind: "MISCONCEPTION",
      conceptId: "photosynthesis",
      statementId: "s-1",
      payload,
      contextId: "ctx-9",
      scope: "PUBLIC",
    });
    expect(asset.kind).toBe("MISCONCEPTION");
    expect(asset.conceptId).toBe("photosynthesis");
    expect(asset.contextId).toBe("ctx-9");
    expect(asset.payload).toBe(payload); // the SAME object, not a copy
    // Producers never self-assert trust (ADR-2), start at version 1, supersede nothing.
    expect(asset.trustLevel).toBe("MACHINE_PROPOSED");
    expect(asset.version).toBe(1);
    expect(asset.supersedes).toBeNull();
    // a real, opaque minted id.
    expect(typeof asset.id).toBe("string");
    expect(asset.id.length).toBeGreaterThan(0);
  });

  it("surfaces the kind validator's verdict alongside the asset (discard when payload is invalid)", () => {
    const { asset, validation } = buildAsset({ kind: "MISCONCEPTION", conceptId: "c", payload: { misconception: "only one half" }, contextId: "ctx" });
    expect(asset.trustLevel).toBe("MACHINE_PROPOSED"); // built regardless — caller decides to store
    expect(validation.outcome).toBe("discard");
    expect(validation.reason).toBe("MISCONCEPTION_NEEDS_MISCONCEPTION_AND_CORRECTION");
  });

  it("mints a distinct id per asset", () => {
    const a = buildAsset({ kind: "MISCONCEPTION", conceptId: "c", payload: misconception, contextId: "ctx" }).asset;
    const b = buildAsset({ kind: "MISCONCEPTION", conceptId: "c", payload: misconception, contextId: "ctx" }).asset;
    expect(a.id).not.toBe(b.id);
  });
});
