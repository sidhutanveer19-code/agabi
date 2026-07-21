import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  registerBlock,
  getBlockDefinition,
  hasBlock,
  allBlockTypes,
} from "@/features/workspace/blocks/registry";
import type { BlockDefinition } from "@/features/workspace/blocks/types";

// Minimal fake definition — the registry stores/returns whatever it is given;
// icon/component are only rendered by the UI, never touched by the registry.
function fakeDef(type: string): BlockDefinition {
  return {
    type,
    label: type,
    category: "text",
    icon: (() => null) as unknown as BlockDefinition["icon"],
    version: 1,
    component: (() => null) as unknown as BlockDefinition["component"],
    schema: z.object({ text: z.string() }) as unknown as BlockDefinition["schema"],
    create: () => ({ text: "" }),
    defaultSize: { w: 100, h: 40 },
    interactive: true,
    resizable: true,
  } as BlockDefinition;
}

describe("block registry", () => {
  it("registers and retrieves a block", () => {
    const t = "__test_block_a";
    expect(hasBlock(t)).toBe(false);
    registerBlock(fakeDef(t));
    expect(hasBlock(t)).toBe(true);
    expect(getBlockDefinition(t)?.type).toBe(t);
    expect(allBlockTypes()).toContain(t);
  });

  it("create() output satisfies the block's own schema", () => {
    const t = "__test_block_b";
    const def = fakeDef(t);
    registerBlock(def);
    expect(def.create).toBeDefined();
    expect(def.schema).toBeDefined();
    const created = def.create!();
    expect(def.schema!.safeParse(created).success).toBe(true);
  });

  it("returns undefined for unknown types", () => {
    expect(getBlockDefinition("__does_not_exist")).toBeUndefined();
  });
});
