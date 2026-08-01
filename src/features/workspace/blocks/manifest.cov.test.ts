import { describe, it, expect, beforeEach } from "vitest";
import { registerWorkspaceBlocks } from "@/features/workspace/blocks/manifest";
import {
  allBlockTypes,
  hasBlock,
  getBlockDefinition,
} from "@/features/workspace/blocks/registry";

/**
 * The complete "alphabet" of block types the manifest wires up, grouped by the
 * `register…()` call in `registerWorkspaceBlocks` that produces each one. Every
 * entry pins the exact string a registrar emits, so removing/altering any single
 * `register…()` statement in manifest.ts flips the exact-set assertion below and
 * gets caught (mutation-gate defense — the manifest body is a straight sequence
 * of side-effecting calls with no branches of its own).
 */
const EXPECTED_TYPES = {
  text: ["paragraph", "richtext", "heading", "subheading", "quote", "notes", "caption"],
  admonition: ["callout", "tip", "warning", "summary", "definition", "example"],
  list: ["bullet", "numbered", "checklist"],
  math: ["formula", "equation", "inline-equation", "display-equation"],
  divider: ["divider"],
  image: ["image"],
  table: ["table"],
  diagram: ["basic-diagram"],
  flow: ["flow"],
  mermaid: ["mermaid"],
  excalidraw: ["excalidraw"],
  tldraw: ["tldraw"],
  chart: ["chart"],
  graph: ["graph"],
  monaco: ["monaco"],
  geometry: ["geometry"],
  mathfield: ["mathfield"],
  threed: ["threed"],
  physics: ["physics"],
  molecule: ["molecule"],
  figure: ["figure"],
  map: ["map"],
  timeline: ["timeline"],
  mindmap: ["mindmap"],
  video: ["video"],
  audio: ["audio"],
  gallery: ["gallery"],
  document: ["document"],
  embed: ["embed"],
} as const;

const ALL_EXPECTED = Object.values(EXPECTED_TYPES).flat();

describe("registerWorkspaceBlocks (manifest)", () => {
  // The registry is a module-level singleton; vitest isolates module state per
  // test file, so within this file it starts empty and only these tests touch it.
  beforeEach(() => {
    registerWorkspaceBlocks();
  });

  it("returns void (no value)", () => {
    // Idempotent second call in-test also proves it does not throw when every
    // block is already present (each registrar early-returns on hasBlock).
    expect(registerWorkspaceBlocks()).toBeUndefined();
  });

  it("registers exactly the full expected alphabet — nothing more, nothing less", () => {
    const registered = new Set(allBlockTypes());
    // Exact set equality pins every register…() call: drop one and a type is
    // missing; add a stray one and the set gains a member. Either way this fails.
    expect(registered).toEqual(new Set(ALL_EXPECTED));
    // No duplicate type strings collapsed the count.
    expect(allBlockTypes()).toHaveLength(ALL_EXPECTED.length);
    expect(ALL_EXPECTED).toHaveLength(45);
  });

  // One assertion per registrar group: proves the effect of every individual
  // register…() statement in the manifest survived (kills per-statement removal).
  for (const [group, types] of Object.entries(EXPECTED_TYPES)) {
    it(`register${group} contributes: ${types.join(", ")}`, () => {
      for (const t of types) {
        expect(hasBlock(t)).toBe(true);
        // Real behavior, not just presence: the stored definition's own `type`
        // must round-trip back to the key it was registered under.
        expect(getBlockDefinition(t)?.type).toBe(t);
      }
    });
  }

  it("is idempotent — a second run neither grows nor mutates the registry", () => {
    const before = allBlockTypes().slice().sort();
    registerWorkspaceBlocks();
    registerWorkspaceBlocks();
    const after = allBlockTypes().slice().sort();
    expect(after).toEqual(before);
    expect(after).toHaveLength(ALL_EXPECTED.length);
  });

  it("every registered definition is a usable block (has a type + create factory)", () => {
    // Guards against a registrar that silently stores a malformed definition —
    // exercises real stored state, not just the key.
    for (const t of ALL_EXPECTED) {
      const def = getBlockDefinition(t);
      expect(def).toBeDefined();
      expect(def?.type).toBe(t);
      expect(typeof def?.create).toBe("function");
    }
  });

  it("does not register a type outside the known alphabet", () => {
    expect(hasBlock("__nonexistent_block__")).toBe(false);
    expect(getBlockDefinition("__nonexistent_block__")).toBeUndefined();
  });
});
