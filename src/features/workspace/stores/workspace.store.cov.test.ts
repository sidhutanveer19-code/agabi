import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore, emptyDoc, type NewBlock } from "@/features/workspace/stores/workspace.store";
import { DEFAULT_REGION_SIZE } from "@/features/workspace/regions/placeRegion";
import { createId, idSuffix } from "@/features/workspace/utils/ids";
import { SCHEMA_VERSION } from "@/features/workspace/types";
import type { BlockInstance, Region, WorkspaceDoc } from "@/features/workspace/types";

/**
 * workspace.store — the PERSISTENT append-only document store (a zustand store).
 *
 * Pure reducers over an in-memory document (no DB/network/clock I/O edge), so
 * every assertion runs the REAL reducer against real data and names the exact
 * resulting value — never "it returned something". Two module-level counters are
 * shared across the process: `seq` in utils/ids (drives createId → block_N /
 * region_N) and `docSeq` in types/defaults (drives emptyDoc ids). Both only ever
 * increase, so tests assert id SHAPE and RELATIVE ordering (via a probe), never a
 * fixed absolute number — that keeps them order-independent.
 *
 * Isolation: beforeEach installs a hand-built doc via setState (NOT via the
 * reducers under test) so each test starts from a known, controlled document.
 *
 * Branch map (both sides of every conditional):
 *   setDoc         — 0 regions / regions-no-blocks / regions-with-blocks; Math.max
 *                    picks the global max suffix; non-numeric ids → 0; identity set.
 *   createRegion   — no opts / custom size (by ref) / accent / empty blocks (skip
 *                    map) / non-empty blocks (map: z ?? i+1, z:0 keeps 0, new ids,
 *                    fields preserved); createdAt = regions.length+1; placeRegion
 *                    non-overlap wiring; default size is a fresh copy.
 *   addBlock       — match (z ?? length+1, z:0 keeps 0, append last, fields kept)
 *                    vs no-match region (untouched) vs non-existent region (id
 *                    still minted, doc unchanged).
 *   updateBlock    — match region+block (patch wins), wrong block, wrong region,
 *                    empty patch, non-existent region.
 *   moveRegion     — match (exact ref, other fields kept) / wrong id / no-op.
 *   setRegionSize  — match / wrong id / no-op.
 *   moveBlock      — match region+block / wrong block / wrong region.
 *   deleteBlock    — remove existing / remove-only / non-existent block (keep all)
 *                    / wrong region / siblings & other regions kept.
 *   duplicateBlock — bad region → null; bad block → null; success (offset +24,
 *                    z=length+1, new id, src untouched, appended); no throw on miss.
 *   reset          — no topic / with topic / clears regions / fresh id each call.
 */

// ---- builders (independent of the reducers under test) ----

function makeBlock(id: string, over: Partial<BlockInstance> = {}): BlockInstance {
  return {
    id,
    type: "text",
    position: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    z: 1,
    data: { text: "hi" },
    ...over,
  };
}

function makeRegion(id: string, blocks: BlockInstance[] = [], over: Partial<Region> = {}): Region {
  return {
    id,
    title: "T",
    position: { x: 0, y: 0 },
    size: { w: 640, h: 460 },
    blocks,
    createdAt: 1,
    ...over,
  };
}

function makeDoc(regions: Region[] = []): WorkspaceDoc {
  return {
    id: "ws_test",
    schemaVersion: SCHEMA_VERSION,
    topic: undefined,
    regions,
    createdAt: 0,
    updatedAt: 0,
  };
}

function newBlock(over: Partial<NewBlock> = {}): NewBlock {
  return {
    type: "text",
    position: { x: 10, y: 20 },
    size: { w: 100, h: 50 },
    data: { text: "x" },
    ...over,
  };
}

const store = () => useWorkspaceStore.getState();
const doc = () => useWorkspaceStore.getState().doc;

// Every test starts from an empty, hand-built document.
beforeEach(() => {
  useWorkspaceStore.setState({ doc: makeDoc([]) });
});

// ---------------------------------------------------------------------------
describe("setDoc — replace + advance the id counter past restored ids", () => {
  it("replaces the document with the EXACT object passed (identity)", () => {
    const restored = makeDoc([makeRegion("region_1")]);
    store().setDoc(restored);
    expect(doc()).toBe(restored);
  });

  it("empty regions → outer loop body never runs; counter is NOT advanced", () => {
    // probe: current seq = base. setDoc of an empty doc computes max=0 → ensureSeqAbove(0)
    // is a no-op (0 !> base), so the very next createRegion is base+1 exactly.
    const base = idSuffix(createId("probe"));
    store().setDoc(makeDoc([]));
    const created = store().createRegion("t");
    expect(idSuffix(created)).toBe(base + 1);
  });

  it("regions but NO blocks → inner loop skipped; counter jumps past the region suffix", () => {
    const base = idSuffix(createId("probe"));
    const target = base + 1000;
    store().setDoc(makeDoc([makeRegion(`region_${target}`, [])]));
    // createRegion mints exactly one id → target+1 proves ensureSeqAbove(target) fired.
    expect(idSuffix(store().createRegion("t"))).toBe(target + 1);
  });

  it("Math.max takes the GLOBAL max across BOTH regions and their nested blocks", () => {
    const base = idSuffix(createId("probe"));
    const hi = base + 5000; // the highest suffix anywhere is a BLOCK, not a region
    const docIn = makeDoc([
      makeRegion(`region_${base + 10}`, [makeBlock(`block_${hi}`)]),
      makeRegion(`region_${base + 30}`, [makeBlock(`block_${base + 20}`)]),
    ]);
    store().setDoc(docIn);
    // next mint must exceed the nested block suffix → hi+1 (proves inner-loop Math.max wins)
    expect(idSuffix(store().createRegion("t"))).toBe(hi + 1);
  });

  it("non-numeric ids parse to suffix 0 → counter stays put (no spurious jump)", () => {
    const base = idSuffix(createId("probe"));
    store().setDoc(makeDoc([makeRegion("region_x", [makeBlock("block_y")])]));
    expect(idSuffix(store().createRegion("t"))).toBe(base + 1);
  });
});

// ---------------------------------------------------------------------------
describe("createRegion — append a non-overlapping explanation region", () => {
  it("no opts → default footprint (a FRESH copy), no accent, no blocks, origin, createdAt=1", () => {
    const id = store().createRegion("Newton's Laws");
    const region = doc().regions.at(-1)!;
    expect(region.id).toBe(id);
    expect(id).toMatch(/^region_\d+$/);
    expect(region.title).toBe("Newton's Laws");
    expect(region.blocks).toEqual([]);
    expect(region.accent).toBeUndefined();
    expect(region.position).toEqual({ x: 0, y: 0 }); // placeRegion on empty doc
    expect(region.createdAt).toBe(1); // regions.length(0) + 1
    // default size equals the exported default but is NOT the shared mutable reference
    expect(region.size).toEqual({ w: 640, h: 460 });
    expect(region.size).not.toBe(DEFAULT_REGION_SIZE);
  });

  it("custom size is used verbatim (same object reference)", () => {
    const size = { w: 200, h: 100 };
    store().createRegion("t", { size });
    expect(doc().regions.at(-1)!.size).toBe(size);
  });

  it("accent is carried onto the region", () => {
    store().createRegion("t", { accent: "#ff0055" });
    expect(doc().regions.at(-1)!.accent).toBe("#ff0055");
  });

  it("createdAt reflects the pre-existing region count (length+1)", () => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_a"), makeRegion("region_b")]) });
    store().createRegion("third");
    expect(doc().regions.at(-1)!.createdAt).toBe(3); // 2 existing + 1
  });

  it("places the new region beside an existing one (placeRegion non-overlap wiring)", () => {
    useWorkspaceStore.setState({
      doc: makeDoc([makeRegion("region_a", [], { position: { x: 0, y: 0 }, size: { w: 640, h: 460 } })]),
    });
    store().createRegion("beside");
    // default packing: colStep = 640+48 = 688 → next free column slot
    expect(doc().regions.at(-1)!.position).toEqual({ x: 688, y: 0 });
  });

  it("empty blocks array → map is skipped, region ends up with zero blocks", () => {
    store().createRegion("t", { blocks: [] });
    expect(doc().regions.at(-1)!.blocks).toEqual([]);
  });

  it("opts present but no blocks key → no throw, region has zero blocks", () => {
    store().createRegion("t", { accent: "x" });
    expect(doc().regions.at(-1)!.blocks).toEqual([]);
  });

  it("non-empty blocks → each gets a NEW block id, z defaults to index+1, fields preserved", () => {
    store().createRegion("t", {
      blocks: [
        newBlock({ position: { x: 1, y: 2 }, data: { text: "a" } }),
        newBlock({ position: { x: 3, y: 4 }, data: { text: "b" } }),
      ],
    });
    const blocks = doc().regions.at(-1)!.blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toMatch(/^block_\d+$/);
    expect(blocks[1].id).toMatch(/^block_\d+$/);
    expect(blocks[0].id).not.toBe(blocks[1].id);
    expect(blocks[0].z).toBe(1); // index 0 + 1
    expect(blocks[1].z).toBe(2); // index 1 + 1
    expect(blocks[0].data).toEqual({ text: "a" });
    expect(blocks[1].position).toEqual({ x: 3, y: 4 });
    expect(blocks[0].type).toBe("text");
  });

  it("an explicit z is honoured; z:0 is kept (?? not ||)", () => {
    store().createRegion("t", {
      blocks: [newBlock({ z: 0 }), newBlock({ z: 99 })],
    });
    const blocks = doc().regions.at(-1)!.blocks;
    expect(blocks[0].z).toBe(0); // nullish-coalescing keeps the falsy-but-defined 0
    expect(blocks[1].z).toBe(99);
  });

  it("region carries its title/createdAt/accent even when blocks are present (spread of region)", () => {
    store().createRegion("Titled", { accent: "#abc", blocks: [newBlock()] });
    const region = doc().regions.at(-1)!;
    expect(region.title).toBe("Titled");
    expect(region.accent).toBe("#abc");
    expect(region.createdAt).toBe(1);
    expect(region.blocks).toHaveLength(1);
  });

  it("appends (does not replace) — existing regions are preserved and the new one is last", () => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_keep")]) });
    const id = store().createRegion("new");
    const regions = doc().regions;
    expect(regions).toHaveLength(2);
    expect(regions[0].id).toBe("region_keep");
    expect(regions[1].id).toBe(id);
  });
});

// ---------------------------------------------------------------------------
describe("addBlock — append a block to a region (streaming-ready)", () => {
  it("appends to the matching region with a new id and z = length+1 when z omitted", () => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_1", [makeBlock("block_1", { z: 1 })])]) });
    const id = store().addBlock("region_1", newBlock());
    const blocks = doc().regions[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[1].id).toBe(id);
    expect(id).toMatch(/^block_\d+$/);
    expect(blocks[1].z).toBe(2); // existing length (1) + 1
    expect(blocks[1].data).toEqual({ text: "x" }); // original fields preserved
    expect(blocks[1].position).toEqual({ x: 10, y: 20 });
  });

  it("into an empty region → first block gets z = 1 (length 0 + 1)", () => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_1", [])]) });
    store().addBlock("region_1", newBlock());
    expect(doc().regions[0].blocks[0].z).toBe(1);
  });

  it("honours an explicit z, and keeps z:0 (?? not ||)", () => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_1", [])]) });
    store().addBlock("region_1", newBlock({ z: 0 }));
    expect(doc().regions[0].blocks[0].z).toBe(0);
    store().addBlock("region_1", newBlock({ z: 42 }));
    expect(doc().regions[0].blocks[1].z).toBe(42);
  });

  it("leaves a NON-matching region untouched (ternary false branch)", () => {
    const other = makeRegion("region_other", [makeBlock("block_o")]);
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_1", []), other]) });
    store().addBlock("region_1", newBlock());
    // the other region keeps its exact prior contents
    expect(doc().regions[1].blocks).toHaveLength(1);
    expect(doc().regions[1].blocks[0].id).toBe("block_o");
  });

  it("non-existent region → still mints & returns a block id, but no region changes", () => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_1", [makeBlock("block_1")])]) });
    const id = store().addBlock("region_nope", newBlock());
    expect(id).toMatch(/^block_\d+$/);
    expect(doc().regions[0].blocks).toHaveLength(1); // unchanged
    expect(doc().regions[0].blocks[0].id).toBe("block_1");
  });
});

// ---------------------------------------------------------------------------
describe("updateBlock — patch a block in place", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [
          makeBlock("block_1", { position: { x: 0, y: 0 }, z: 1, data: { text: "old" } }),
          makeBlock("block_2", { z: 2 }),
        ]),
        makeRegion("region_2", [makeBlock("block_3")]),
      ]),
    });
  });

  it("merges the patch over the target block; patch wins, other fields preserved", () => {
    store().updateBlock("region_1", "block_1", { position: { x: 9, y: 9 }, data: { text: "new" } });
    const b = doc().regions[0].blocks[0];
    expect(b.position).toEqual({ x: 9, y: 9 }); // patched
    expect(b.data).toEqual({ text: "new" }); // patched
    expect(b.id).toBe("block_1"); // preserved
    expect(b.z).toBe(1); // untouched field preserved
  });

  it("can patch a single scalar field (z) and leave the rest", () => {
    store().updateBlock("region_1", "block_1", { z: 77 });
    const b = doc().regions[0].blocks[0];
    expect(b.z).toBe(77);
    expect(b.data).toEqual({ text: "old" });
  });

  it("an empty patch leaves the block value unchanged", () => {
    store().updateBlock("region_1", "block_1", {});
    expect(doc().regions[0].blocks[0]).toEqual(
      makeBlock("block_1", { position: { x: 0, y: 0 }, z: 1, data: { text: "old" } }),
    );
  });

  it("a sibling block in the same region is NOT touched (block ternary false branch)", () => {
    store().updateBlock("region_1", "block_1", { z: 5 });
    expect(doc().regions[0].blocks[1].z).toBe(2); // block_2 unchanged
  });

  it("wrong block id in the region → nothing changes", () => {
    store().updateBlock("region_1", "block_missing", { z: 123 });
    expect(doc().regions[0].blocks.map((b) => b.z)).toEqual([1, 2]);
  });

  it("wrong region id → no region's blocks are scanned or changed", () => {
    store().updateBlock("region_nope", "block_1", { z: 123 });
    expect(doc().regions[0].blocks[0].z).toBe(1);
    expect(doc().regions[1].blocks[0].z).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("moveRegion — programmatic region move", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [makeBlock("block_1")], { position: { x: 0, y: 0 } }),
        makeRegion("region_2", [], { position: { x: 5, y: 5 } }),
      ]),
    });
  });

  it("sets the matching region's position to the EXACT vector passed", () => {
    const pos = { x: 300, y: 400 };
    store().moveRegion("region_1", pos);
    expect(doc().regions[0].position).toBe(pos); // by reference
  });

  it("preserves the moved region's other fields (blocks, title)", () => {
    store().moveRegion("region_1", { x: 1, y: 2 });
    expect(doc().regions[0].blocks[0].id).toBe("block_1");
    expect(doc().regions[0].title).toBe("T");
  });

  it("leaves a non-matching region's position alone", () => {
    store().moveRegion("region_1", { x: 1, y: 2 });
    expect(doc().regions[1].position).toEqual({ x: 5, y: 5 });
  });

  it("non-existent region → no position changes anywhere", () => {
    store().moveRegion("region_nope", { x: 9, y: 9 });
    expect(doc().regions[0].position).toEqual({ x: 0, y: 0 });
    expect(doc().regions[1].position).toEqual({ x: 5, y: 5 });
  });
});

// ---------------------------------------------------------------------------
describe("setRegionSize — resize a region", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [], { size: { w: 640, h: 460 } }),
        makeRegion("region_2", [], { size: { w: 100, h: 100 } }),
      ]),
    });
  });

  it("sets the matching region's size to the EXACT object passed", () => {
    const size = { w: 800, h: 600 };
    store().setRegionSize("region_1", size);
    expect(doc().regions[0].size).toBe(size);
  });

  it("leaves a non-matching region's size alone", () => {
    store().setRegionSize("region_1", { w: 800, h: 600 });
    expect(doc().regions[1].size).toEqual({ w: 100, h: 100 });
  });

  it("non-existent region → no size changes anywhere", () => {
    store().setRegionSize("region_nope", { w: 1, h: 1 });
    expect(doc().regions[0].size).toEqual({ w: 640, h: 460 });
    expect(doc().regions[1].size).toEqual({ w: 100, h: 100 });
  });
});

// ---------------------------------------------------------------------------
describe("moveBlock — move a block within its region", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [
          makeBlock("block_1", { position: { x: 0, y: 0 }, data: { text: "keep" } }),
          makeBlock("block_2", { position: { x: 1, y: 1 } }),
        ]),
        makeRegion("region_2", [makeBlock("block_3", { position: { x: 7, y: 7 } })]),
      ]),
    });
  });

  it("sets the matching block's position to the EXACT vector, keeping other fields", () => {
    const pos = { x: 50, y: 60 };
    store().moveBlock("region_1", "block_1", pos);
    const b = doc().regions[0].blocks[0];
    expect(b.position).toBe(pos);
    expect(b.data).toEqual({ text: "keep" }); // preserved
  });

  it("a sibling block is not moved (block ternary false branch)", () => {
    store().moveBlock("region_1", "block_1", { x: 50, y: 60 });
    expect(doc().regions[0].blocks[1].position).toEqual({ x: 1, y: 1 });
  });

  it("wrong region id → nothing moves", () => {
    store().moveBlock("region_nope", "block_1", { x: 50, y: 60 });
    expect(doc().regions[0].blocks[0].position).toEqual({ x: 0, y: 0 });
    expect(doc().regions[1].blocks[0].position).toEqual({ x: 7, y: 7 });
  });

  it("right region but wrong block id → nothing moves", () => {
    store().moveBlock("region_1", "block_missing", { x: 50, y: 60 });
    expect(doc().regions[0].blocks.map((b) => b.position)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("deleteBlock — remove a block (block-level edit only)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [makeBlock("block_1"), makeBlock("block_2")]),
        makeRegion("region_2", [makeBlock("block_3")]),
      ]),
    });
  });

  it("removes the target block and keeps its siblings", () => {
    store().deleteBlock("region_1", "block_1");
    expect(doc().regions[0].blocks.map((b) => b.id)).toEqual(["block_2"]);
  });

  it("removing the only block leaves an empty block list (region stays)", () => {
    store().deleteBlock("region_2", "block_3");
    expect(doc().regions[1].blocks).toEqual([]);
    expect(doc().regions).toHaveLength(2); // region itself is NOT removed
  });

  it("non-existent block id → filter keeps every block", () => {
    store().deleteBlock("region_1", "block_missing");
    expect(doc().regions[0].blocks.map((b) => b.id)).toEqual(["block_1", "block_2"]);
  });

  it("wrong region id → no block removed anywhere", () => {
    store().deleteBlock("region_nope", "block_1");
    expect(doc().regions[0].blocks).toHaveLength(2);
    expect(doc().regions[1].blocks).toHaveLength(1);
  });

  it("a different region's blocks are untouched by a delete", () => {
    store().deleteBlock("region_1", "block_1");
    expect(doc().regions[1].blocks.map((b) => b.id)).toEqual(["block_3"]);
  });
});

// ---------------------------------------------------------------------------
describe("duplicateBlock — copy a block within its region", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [
          makeBlock("block_1", { position: { x: 100, y: 200 }, z: 1, data: { text: "src" } }),
          makeBlock("block_2", { position: { x: 5, y: 5 }, z: 2 }),
        ]),
      ]),
    });
  });

  it("unknown region → returns null and changes nothing", () => {
    const result = store().duplicateBlock("region_nope", "block_1");
    expect(result).toBeNull();
    expect(doc().regions[0].blocks).toHaveLength(2);
  });

  it("known region but unknown block → returns null (no throw) and changes nothing", () => {
    const result = store().duplicateBlock("region_1", "block_missing");
    expect(result).toBeNull();
    expect(doc().regions[0].blocks).toHaveLength(2);
  });

  it("duplicates: new id, +24/+24 offset, z = blocks.length+1, other fields copied", () => {
    const newId = store().duplicateBlock("region_1", "block_1");
    const blocks = doc().regions[0].blocks;
    expect(blocks).toHaveLength(3);
    const copy = blocks[2];
    expect(copy.id).toBe(newId);
    expect(newId).toMatch(/^block_\d+$/);
    expect(copy.id).not.toBe("block_1");
    expect(copy.position).toEqual({ x: 124, y: 224 }); // 100+24, 200+24
    expect(copy.z).toBe(3); // 2 existing blocks + 1
    expect(copy.data).toEqual({ text: "src" }); // copied
    expect(copy.type).toBe("text");
  });

  it("does NOT mutate the source block", () => {
    store().duplicateBlock("region_1", "block_1");
    expect(doc().regions[0].blocks[0].position).toEqual({ x: 100, y: 200 }); // src intact
    expect(doc().regions[0].blocks[0].z).toBe(1);
  });

  it("appends the copy as the LAST block", () => {
    const newId = store().duplicateBlock("region_1", "block_2");
    expect(doc().regions[0].blocks.at(-1)!.id).toBe(newId);
  });
});

// ---------------------------------------------------------------------------
describe("reset — clear back to an empty document", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_1", [makeBlock("block_1")])]) });
  });

  it("no topic → empty regions, undefined topic, current schema version", () => {
    store().reset();
    expect(doc().regions).toEqual([]);
    expect(doc().topic).toBeUndefined();
    expect(doc().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("with a topic → seeds doc.topic and still clears regions", () => {
    store().reset("Photosynthesis");
    expect(doc().topic).toBe("Photosynthesis");
    expect(doc().regions).toEqual([]);
  });

  it("mints a fresh document id on each reset (docSeq advances)", () => {
    store().reset();
    const first = doc().id;
    store().reset();
    const second = doc().id;
    expect(first).toMatch(/^ws_\d+$/);
    expect(second).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
describe("re-exported emptyDoc", () => {
  it("is the real builder: empty regions + current schema version", () => {
    const d = emptyDoc("algebra");
    expect(d.regions).toEqual([]);
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.topic).toBe("algebra");
    expect(d.id).toMatch(/^ws_\d+$/);
  });

  it("emptyDoc() with no topic leaves topic undefined", () => {
    expect(emptyDoc().topic).toBeUndefined();
  });
});

// ===========================================================================
// Additional coverage (extends the branch map above with reference-identity,
// per-index z mixing, world-space row wrap, cross-region isolation, and the
// setDoc id-protection guarantee for streamed blocks — not just regions).
// ===========================================================================

// ---------------------------------------------------------------------------
describe("setDoc — restored ids protect BOTH freshly-minted regions AND blocks", () => {
  it("addBlock after a restore mints a block id ABOVE the highest restored suffix", () => {
    const base = idSuffix(createId("probe"));
    const target = base + 2000; // the highest restored suffix lives on a BLOCK
    store().setDoc(makeDoc([makeRegion(`region_${base + 1}`, [makeBlock(`block_${target}`)])]));
    // ensureSeqAbove(target) must have fired → the next block mint is target+1
    const id = store().addBlock(`region_${base + 1}`, newBlock());
    expect(idSuffix(id)).toBe(target + 1);
  });
});

// ---------------------------------------------------------------------------
describe("createRegion — per-index z default is the ACTUAL array index, not a counter", () => {
  it("mixes omitted z (→ i+1) with an explicit z:0, proving `?? i + 1` is index-based", () => {
    store().createRegion("t", {
      blocks: [
        newBlock({ data: { text: "a" } }), // index 0, no z → 0 + 1
        newBlock({ z: 0, data: { text: "b" } }), // index 1, explicit 0 → kept
        newBlock({ data: { text: "c" } }), // index 2, no z → 2 + 1
      ],
    });
    const blocks = doc().regions.at(-1)!.blocks;
    expect(blocks.map((b) => b.z)).toEqual([1, 0, 3]);
    // the z:0 entry did NOT shift the following index's default (rules out a running counter)
    expect(blocks[2].z).toBe(3);
    expect(blocks.map((b) => (b.data as { text: string }).text)).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
describe("createRegion — placeRegion wiring wraps to a new row once a row is full", () => {
  it("with all three default-width column slots in row 0 taken, the new region drops to row 1 col 0", () => {
    // Default footprint 640x460, GAP 48 → colStep 688; ROW_WIDTH 2400 → 3 columns (0,688,1376).
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_a", [], { position: { x: 0, y: 0 }, size: { w: 640, h: 460 } }),
        makeRegion("region_b", [], { position: { x: 688, y: 0 }, size: { w: 640, h: 460 } }),
        makeRegion("region_c", [], { position: { x: 1376, y: 0 }, size: { w: 640, h: 460 } }),
      ]),
    });
    store().createRegion("wraps");
    // row 1: y = 460 + 48 = 508, back to the first column.
    expect(doc().regions.at(-1)!.position).toEqual({ x: 0, y: 508 });
  });
});

// ---------------------------------------------------------------------------
describe("duplicateBlock — targets the right region and leaves others untouched", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [makeBlock("block_1")]),
        makeRegion("region_2", [
          makeBlock("block_2", { position: { x: 10, y: 20 }, z: 1 }),
          makeBlock("block_3", { z: 2 }),
        ]),
      ]),
    });
  });

  it("duplicating a block in the SECOND region appends there and never touches the first", () => {
    const newId = store().duplicateBlock("region_2", "block_2");
    expect(newId).toMatch(/^block_\d+$/);
    // first region is completely unchanged
    expect(doc().regions[0].blocks.map((b) => b.id)).toEqual(["block_1"]);
    // copy appended to region_2 with z = 2 existing + 1 and the +24/+24 offset
    const region2 = doc().regions[1].blocks;
    expect(region2.map((b) => b.id)).toEqual(["block_2", "block_3", newId]);
    expect(region2.at(-1)!.z).toBe(3);
    expect(region2.at(-1)!.position).toEqual({ x: 34, y: 44 }); // 10+24, 20+24
  });
});

// ---------------------------------------------------------------------------
// Structural sharing / immutability. Each reducer must return a NEW doc object,
// build a NEW array/object for the node it touched, and carry every UNTOUCHED
// node forward BY REFERENCE (the `: r` / `: b` ternary false branches). These
// reference assertions kill mutants that clone-everything or mutate-in-place.
describe("structural sharing — new object for the touched node, references kept for the rest", () => {
  it("createRegion: fresh doc + regions array, but pre-existing regions kept by reference", () => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_keep")]) });
    const prev = doc();
    store().createRegion("new");
    const next = doc();
    expect(next).not.toBe(prev); // new doc object
    expect(next.regions).not.toBe(prev.regions); // new array
    expect(prev.regions).toHaveLength(1); // old array not mutated
    expect(next.regions[0]).toBe(prev.regions[0]); // untouched region carried by reference
  });

  it("addBlock: matched region is a new object; the other region is the SAME reference", () => {
    useWorkspaceStore.setState({
      doc: makeDoc([makeRegion("region_1", [makeBlock("block_1")]), makeRegion("region_2", [])]),
    });
    const prev = doc();
    store().addBlock("region_1", newBlock());
    const next = doc();
    expect(next).not.toBe(prev);
    expect(next.regions[0]).not.toBe(prev.regions[0]); // matched → rebuilt
    expect(next.regions[1]).toBe(prev.regions[1]); // unmatched → same reference
    expect(prev.regions[0].blocks).toHaveLength(1); // prior region's block list not mutated
  });

  it("updateBlock: rebuilds the matched block, keeps the sibling and other region by reference", () => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [
          makeBlock("block_1", { z: 1, data: { text: "old" } }),
          makeBlock("block_2", { z: 2 }),
        ]),
        makeRegion("region_2", [makeBlock("block_3")]),
      ]),
    });
    const prev = doc();
    store().updateBlock("region_1", "block_1", { z: 9 });
    const next = doc();
    expect(next.regions[1]).toBe(prev.regions[1]); // other region untouched (same ref)
    expect(next.regions[0]).not.toBe(prev.regions[0]); // matched region rebuilt
    expect(next.regions[0].blocks[0]).not.toBe(prev.regions[0].blocks[0]); // matched block rebuilt
    expect(next.regions[0].blocks[1]).toBe(prev.regions[0].blocks[1]); // sibling kept by reference
    expect(prev.regions[0].blocks[0].z).toBe(1); // original block object not mutated
  });

  it("moveRegion: matched region rebuilt, non-matching region kept by reference", () => {
    useWorkspaceStore.setState({
      doc: makeDoc([makeRegion("region_1"), makeRegion("region_2")]),
    });
    const prev = doc();
    store().moveRegion("region_1", { x: 1, y: 2 });
    const next = doc();
    expect(next.regions[0]).not.toBe(prev.regions[0]);
    expect(next.regions[1]).toBe(prev.regions[1]);
    expect(prev.regions[0].position).toEqual({ x: 0, y: 0 }); // original not mutated
  });

  it("setRegionSize: matched region rebuilt, non-matching region kept by reference", () => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [], { size: { w: 1, h: 1 } }),
        makeRegion("region_2", [], { size: { w: 2, h: 2 } }),
      ]),
    });
    const prev = doc();
    store().setRegionSize("region_1", { w: 9, h: 9 });
    const next = doc();
    expect(next.regions[0]).not.toBe(prev.regions[0]);
    expect(next.regions[1]).toBe(prev.regions[1]);
    expect(prev.regions[0].size).toEqual({ w: 1, h: 1 }); // original not mutated
  });

  it("moveBlock: matched block rebuilt, sibling + other region kept by reference", () => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [makeBlock("block_1"), makeBlock("block_2")]),
        makeRegion("region_2", [makeBlock("block_3")]),
      ]),
    });
    const prev = doc();
    store().moveBlock("region_1", "block_1", { x: 5, y: 6 });
    const next = doc();
    expect(next.regions[1]).toBe(prev.regions[1]);
    expect(next.regions[0].blocks[0]).not.toBe(prev.regions[0].blocks[0]);
    expect(next.regions[0].blocks[1]).toBe(prev.regions[0].blocks[1]);
    expect(prev.regions[0].blocks[0].position).toEqual({ x: 0, y: 0 }); // original not mutated
  });

  it("deleteBlock: matched region rebuilt, non-matching region kept by reference", () => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [makeBlock("block_1"), makeBlock("block_2")]),
        makeRegion("region_2", [makeBlock("block_3")]),
      ]),
    });
    const prev = doc();
    store().deleteBlock("region_1", "block_1");
    const next = doc();
    expect(next.regions[0]).not.toBe(prev.regions[0]);
    expect(next.regions[1]).toBe(prev.regions[1]);
    expect(prev.regions[0].blocks).toHaveLength(2); // original block list not mutated
  });

  it("duplicateBlock: matched region rebuilt, non-matching region kept by reference", () => {
    useWorkspaceStore.setState({
      doc: makeDoc([
        makeRegion("region_1", [makeBlock("block_1")]),
        makeRegion("region_2", [makeBlock("block_2")]),
      ]),
    });
    const prev = doc();
    store().duplicateBlock("region_1", "block_1");
    const next = doc();
    expect(next).not.toBe(prev);
    expect(next.regions[0]).not.toBe(prev.regions[0]);
    expect(next.regions[1]).toBe(prev.regions[1]);
    expect(prev.regions[0].blocks).toHaveLength(1); // original block list not mutated
  });

  it("duplicateBlock on a MISS does not swap in a new doc object (early return, no set)", () => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_1", [makeBlock("block_1")])]) });
    const prev = doc();
    const result = store().duplicateBlock("region_1", "block_missing");
    expect(result).toBeNull();
    expect(doc()).toBe(prev); // identical reference — set() was never called
  });

  it("reset: installs a brand-new doc object distinct from the prior one", () => {
    useWorkspaceStore.setState({ doc: makeDoc([makeRegion("region_1")]) });
    const prev = doc();
    store().reset();
    expect(doc()).not.toBe(prev);
    expect(prev.regions).toHaveLength(1); // prior doc untouched
  });
});
