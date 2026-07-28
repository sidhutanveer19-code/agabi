import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockDefinition } from "@/features/workspace/blocks/types";

/**
 * Exhaustive coverage for the block registry (registry.ts). Every exported
 * function and every branch of `paletteBlockDefinitions`' filter is exercised
 * with EXACT-value assertions (not "it ran"), so a mutation to the source flips
 * a test red.
 *
 * The registry is a module-level singleton `Map`, so each test gets a FRESH
 * module instance via `vi.resetModules()` + dynamic import. That lets us assert
 * exact array lengths/contents/order instead of fighting cross-test state — and
 * it exercises the real module, not a stand-in.
 */

type RegistryModule = typeof import("@/features/workspace/blocks/registry");

let reg: RegistryModule;

beforeEach(async () => {
  vi.resetModules();
  reg = await import("@/features/workspace/blocks/registry");
});

// A no-op component/icon — the registry never renders them, it only stores/returns.
const noop = (() => null) as unknown as BlockDefinition["component"];

function makeDef(overrides: Partial<BlockDefinition> & { type: string }): BlockDefinition {
  return {
    label: overrides.label ?? overrides.type,
    component: overrides.component ?? noop,
    category: overrides.category ?? "text",
    interactive: overrides.interactive,
    create: overrides.create,
    ...overrides,
  } as BlockDefinition;
}

describe("registry — empty state", () => {
  it("returns empty collections before anything is registered", () => {
    expect(reg.allBlockTypes()).toEqual([]);
    expect(reg.allBlockDefinitions()).toEqual([]);
    expect(reg.paletteBlockDefinitions()).toEqual([]);
    expect(reg.hasBlock("anything")).toBe(false);
    expect(reg.getBlockDefinition("anything")).toBeUndefined();
  });
});

describe("registerBlock + getBlockDefinition", () => {
  it("stores the exact definition object under its type key", () => {
    const def = makeDef({ type: "alpha", label: "Alpha" });
    reg.registerBlock(def);
    // Same object identity is returned — not a copy.
    expect(reg.getBlockDefinition("alpha")).toBe(def);
    expect(reg.getBlockDefinition("alpha")?.label).toBe("Alpha");
  });

  it("keys the map by def.type, not by any other field", () => {
    const def = makeDef({ type: "the-key", label: "different-label" });
    reg.registerBlock(def);
    expect(reg.getBlockDefinition("the-key")).toBe(def);
    // Not retrievable by the label.
    expect(reg.getBlockDefinition("different-label")).toBeUndefined();
  });

  it("re-registering the same type overwrites the previous definition", () => {
    const first = makeDef({ type: "dup", label: "first" });
    const second = makeDef({ type: "dup", label: "second" });
    reg.registerBlock(first);
    reg.registerBlock(second);
    expect(reg.getBlockDefinition("dup")).toBe(second);
    expect(reg.getBlockDefinition("dup")?.label).toBe("second");
    // Overwrite, not append — still exactly one "dup" entry.
    expect(reg.allBlockTypes().filter((t) => t === "dup")).toEqual(["dup"]);
    expect(reg.allBlockDefinitions()).toHaveLength(1);
  });

  it("getBlockDefinition returns undefined for an unregistered type", () => {
    reg.registerBlock(makeDef({ type: "present" }));
    expect(reg.getBlockDefinition("absent")).toBeUndefined();
    // Registering one type does not make a different type resolvable.
    expect(reg.getBlockDefinition("present")).toBeDefined();
  });
});

describe("hasBlock", () => {
  it("is true only after a type is registered, false otherwise", () => {
    expect(reg.hasBlock("hb")).toBe(false);
    reg.registerBlock(makeDef({ type: "hb" }));
    expect(reg.hasBlock("hb")).toBe(true);
    // A near-miss key is still false.
    expect(reg.hasBlock("hb ")).toBe(false);
    expect(reg.hasBlock("HB")).toBe(false);
  });
});

describe("allBlockTypes", () => {
  it("returns keys in registration order", () => {
    reg.registerBlock(makeDef({ type: "one" }));
    reg.registerBlock(makeDef({ type: "two" }));
    reg.registerBlock(makeDef({ type: "three" }));
    expect(reg.allBlockTypes()).toEqual(["one", "two", "three"]);
  });

  it("returns a fresh array copy — mutating it does not affect the registry", () => {
    reg.registerBlock(makeDef({ type: "keep" }));
    const arr = reg.allBlockTypes();
    arr.push("injected");
    arr.pop();
    arr.pop();
    // Registry is unchanged by mutating the returned array.
    expect(reg.allBlockTypes()).toEqual(["keep"]);
    expect(reg.hasBlock("injected")).toBe(false);
  });
});

describe("allBlockDefinitions", () => {
  it("returns definition objects in registration order", () => {
    const a = makeDef({ type: "a" });
    const b = makeDef({ type: "b" });
    reg.registerBlock(a);
    reg.registerBlock(b);
    expect(reg.allBlockDefinitions()).toEqual([a, b]);
    // Exact object identity + order preserved.
    expect(reg.allBlockDefinitions()[0]).toBe(a);
    expect(reg.allBlockDefinitions()[1]).toBe(b);
  });

  it("returns a fresh array copy — mutating it does not affect the registry", () => {
    const only = makeDef({ type: "solo" });
    reg.registerBlock(only);
    const defs = reg.allBlockDefinitions();
    defs.length = 0;
    expect(reg.allBlockDefinitions()).toEqual([only]);
  });
});

describe("paletteBlockDefinitions — both sides of every filter branch", () => {
  it("includes a block that is interactive AND has a create factory", () => {
    const def = makeDef({ type: "insertable", interactive: true, create: () => ({}) });
    reg.registerBlock(def);
    expect(reg.paletteBlockDefinitions()).toEqual([def]);
  });

  it("excludes a block that is NOT interactive even if it has a create factory", () => {
    // Left operand false → short-circuits regardless of create.
    reg.registerBlock(makeDef({ type: "non-interactive", interactive: false, create: () => ({}) }));
    expect(reg.paletteBlockDefinitions()).toEqual([]);
  });

  it("excludes a block whose interactive is undefined", () => {
    reg.registerBlock(makeDef({ type: "no-flag", create: () => ({}) }));
    expect(reg.paletteBlockDefinitions()).toEqual([]);
  });

  it("excludes an interactive block that has NO create factory (create undefined)", () => {
    // Right operand false → typeof undefined !== "function".
    reg.registerBlock(makeDef({ type: "no-factory", interactive: true, create: undefined }));
    expect(reg.paletteBlockDefinitions()).toEqual([]);
  });

  it("excludes an interactive block whose create is a non-function value", () => {
    // typeof "function" guard: a truthy but non-callable create must be rejected.
    const def = makeDef({ type: "bad-factory", interactive: true });
    (def as unknown as { create: unknown }).create = "not-a-function";
    reg.registerBlock(def);
    expect(reg.paletteBlockDefinitions()).toEqual([]);
  });

  it("returns only the qualifying blocks, in registration order, out of a mixed set", () => {
    const good1 = makeDef({ type: "g1", interactive: true, create: () => ({}) });
    const bad1 = makeDef({ type: "b1", interactive: false, create: () => ({}) });
    const good2 = makeDef({ type: "g2", interactive: true, create: () => ({}) });
    const bad2 = makeDef({ type: "b2", interactive: true, create: undefined });
    reg.registerBlock(good1);
    reg.registerBlock(bad1);
    reg.registerBlock(good2);
    reg.registerBlock(bad2);
    // Full set still has all four; palette is filtered to the two qualifying ones, in order.
    expect(reg.allBlockDefinitions()).toHaveLength(4);
    expect(reg.paletteBlockDefinitions()).toEqual([good1, good2]);
  });

  it("preserves the create factory so it produces real default data", () => {
    const def = makeDef({ type: "factory", interactive: true, create: () => ({ text: "hi" }) });
    reg.registerBlock(def);
    const palette = reg.paletteBlockDefinitions();
    expect(palette).toHaveLength(1);
    expect(palette[0].create?.()).toEqual({ text: "hi" });
  });
});

describe("registerBlock — insertion order is stable across overwrites", () => {
  it("re-registering an existing type keeps its original position (Map semantics)", () => {
    const a1 = makeDef({ type: "a", label: "a-first" });
    reg.registerBlock(a1);
    reg.registerBlock(makeDef({ type: "b" }));
    reg.registerBlock(makeDef({ type: "c" }));
    // Overwrite the FIRST-registered type after later ones already exist.
    const a2 = makeDef({ type: "a", label: "a-second" });
    reg.registerBlock(a2);
    // Order is unchanged — "a" stays first, it is NOT moved to the end.
    expect(reg.allBlockTypes()).toEqual(["a", "b", "c"]);
    // ...but the value at that position is the NEW definition.
    expect(reg.getBlockDefinition("a")).toBe(a2);
    expect(reg.allBlockDefinitions()[0]).toBe(a2);
    expect(reg.allBlockDefinitions()[0].label).toBe("a-second");
    // The overwritten object is gone from every view.
    expect(reg.allBlockDefinitions()).not.toContain(a1);
  });
});

describe("empty-string type is a valid, distinct key", () => {
  it("registers, resolves, and lists a block whose type is the empty string", () => {
    const empty = makeDef({ type: "", label: "no-type" });
    expect(reg.hasBlock("")).toBe(false);
    reg.registerBlock(empty);
    expect(reg.hasBlock("")).toBe(true);
    expect(reg.getBlockDefinition("")).toBe(empty);
    expect(reg.allBlockTypes()).toEqual([""]);
    expect(reg.allBlockDefinitions()).toEqual([empty]);
    // A whitespace key is a DIFFERENT key — the empty string is not a wildcard.
    expect(reg.hasBlock(" ")).toBe(false);
    expect(reg.getBlockDefinition(" ")).toBeUndefined();
  });
});

describe("paletteBlockDefinitions — create judged by callability, not return value", () => {
  it("includes an interactive block whose create returns undefined (still a function)", () => {
    // The filter is `typeof create === "function"`, independent of what create returns.
    const def = makeDef({ type: "void-factory", interactive: true, create: () => undefined });
    reg.registerBlock(def);
    const palette = reg.paletteBlockDefinitions();
    expect(palette).toEqual([def]);
    expect(palette[0].create?.()).toBeUndefined();
  });

  it("returns a fresh array — distinct from allBlockDefinitions and safe to mutate", () => {
    const def = makeDef({ type: "p", interactive: true, create: () => ({}) });
    reg.registerBlock(def);
    const first = reg.paletteBlockDefinitions();
    const second = reg.paletteBlockDefinitions();
    // A new array object on every call...
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    // ...and never the same array object as allBlockDefinitions.
    expect(first).not.toBe(reg.allBlockDefinitions());
    // Mutating the returned array cannot corrupt the registry.
    first.length = 0;
    expect(reg.paletteBlockDefinitions()).toEqual([def]);
  });
});

describe("create factories produce fresh data on each call", () => {
  it("invokes create anew so returned data is not a shared singleton", () => {
    const def = makeDef({
      type: "fresh",
      interactive: true,
      create: () => ({ items: [] as string[] }),
    });
    reg.registerBlock(def);
    const d = reg.getBlockDefinition("fresh")!;
    const a = d.create!() as { items: string[] };
    const b = d.create!() as { items: string[] };
    expect(a).toEqual({ items: [] });
    // Distinct object identities — the factory ran twice, it is not memoized.
    expect(a).not.toBe(b);
    // Mutating one instance must not bleed into the next fresh instance.
    a.items.push("x");
    expect((d.create!() as { items: string[] }).items).toEqual([]);
  });
});
