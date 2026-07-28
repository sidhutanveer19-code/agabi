import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { BlockDefinition } from "@/features/workspace/blocks/types";
import type { BlockInstance, Region } from "@/features/workspace/types";
import { insertBlock, pasteBlock } from "@/features/workspace/blocks/insertBlock";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useUiStore } from "@/features/workspace/stores/ui.store";
import { blockClipboard } from "@/features/workspace/blocks/shared/clipboard";
import { emptyDoc } from "@/features/workspace/types/defaults";

/**
 * insertBlock / pasteBlock — the dev-authoring insert path (also the future AI's API).
 *
 * There is NO I/O boundary here: the module composes pure in-memory logic — three
 * zustand stores (workspace doc, camera, ui selection), the pure screenToWorld
 * transform, and the in-memory block clipboard. So the SUCCESS tests run the WHOLE
 * real pipeline (real stores + real math) and assert the EXACT region/block that
 * lands in the document and the EXACT selection that results — never "it ran".
 *
 * Branches asserted for real:
 *   - `def.defaultSize ?? {420,140}`      : present size  vs  fallback size
 *   - `def.create ? def.create() : {}`    : factory data forwarded by ref  vs  {}
 *   - `def.label ?? def.type`             : label as title  vs  type fallback
 *   - real screenToWorld (offset+zoom camera; negative coord) + Math.round on the .5
 *   - append-only: a 2nd insert adds a 2nd region and reselects the new block
 *   - pasteBlock `if (!src) return`       : empty clipboard early-return  vs  populated
 *   - pasteBlock offset math (+20,+20) and NEW block id (not the source's)
 * The only fake is at the store seam, used to reach the DEFENSIVE guards that the
 * public API cannot otherwise produce (`region?.blocks[0]?.id` / `if (blockId)` — a
 * region with no findable block): fault-injection per §H.9, asserting the real result
 * (no selection, no throw), not "didn't crash".
 */

/** A minimal but real BlockDefinition (component never renders in node). */
function makeDef(over: Partial<BlockDefinition> = {}): BlockDefinition {
  return { type: "text", label: "Text", component: () => null, ...over };
}

/** A def with NO label, to drive the `def.label ?? def.type` fallback for real. */
function defWithoutLabel(type: string): BlockDefinition {
  const base: Omit<BlockDefinition, "label"> = { type, component: () => null };
  return base as BlockDefinition;
}

type WorkspaceState = ReturnType<typeof useWorkspaceStore.getState>;

beforeEach(() => {
  // Fresh, deterministic state for every case (stores are module singletons).
  useWorkspaceStore.setState({ doc: emptyDoc() });
  useCameraStore.setState({ camera: { x: 0, y: 0, scale: 1 } });
  useUiStore.setState({ selectedIds: [], hoverId: null, focusId: null, interaction: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("insertBlock — success paths (whole real pipeline)", () => {
  it("no defaultSize/create/label → 420×140 fallback, {} data, label title, centered+rounded, selects block", () => {
    // camera {0,0,1}, viewport 1000×800 → world center {500,400}
    insertBlock(makeDef(), { w: 1000, h: 800 });

    const doc = useWorkspaceStore.getState().doc;
    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.title).toBe("Text"); // def.label used
    expect(region.size).toEqual({ w: 420, h: 140 }); // ?? fallback size
    // pos = round(500 - 420/2)=290, round(400 - 140/2)=330 (moveRegion overrides placeRegion)
    expect(region.position).toEqual({ x: 290, y: 330 });

    expect(region.blocks).toHaveLength(1);
    const block = region.blocks[0];
    expect(block.type).toBe("text");
    expect(block.position).toEqual({ x: 0, y: 0 }); // region-local origin
    expect(block.size).toEqual({ w: 420, h: 140 });
    expect(block.data).toEqual({}); // no def.create → {}

    expect(useUiStore.getState().selectedIds).toEqual([block.id]);
    expect(useUiStore.getState().focusId).toBe(block.id);
  });

  it("uses def.defaultSize, forwards def.create() data BY REFERENCE, def.label as title", () => {
    const created = { text: "hello", n: 7 };
    const def = makeDef({
      type: "math",
      label: "Equation",
      defaultSize: { w: 300, h: 200 },
      create: () => created,
    });
    insertBlock(def, { w: 1000, h: 800 });

    const region = useWorkspaceStore.getState().doc.regions[0];
    expect(region.title).toBe("Equation");
    expect(region.size).toEqual({ w: 300, h: 200 });
    // pos = round(500-150)=350, round(400-100)=300
    expect(region.position).toEqual({ x: 350, y: 300 });

    const block = region.blocks[0];
    expect(block.size).toEqual({ w: 300, h: 200 });
    expect(block.data).toEqual({ text: "hello", n: 7 });
    expect(block.data).toBe(created); // create() result forwarded, not cloned
    expect(useUiStore.getState().selectedIds).toEqual([block.id]);
  });

  it("no label → region title falls back to def.type", () => {
    insertBlock(defWithoutLabel("diagram"), { w: 1000, h: 800 });
    expect(useWorkspaceStore.getState().doc.regions[0].title).toBe("diagram");
  });

  it("applies the REAL screenToWorld through an offset+zoomed camera (negative coord)", () => {
    useCameraStore.setState({ camera: { x: 100, y: 50, scale: 2 } });
    insertBlock(makeDef(), { w: 1000, h: 800 });
    // c = {(500-100)/2=200, (400-50)/2=175}; pos = round(200-210)=-10, round(175-70)=105
    expect(useWorkspaceStore.getState().doc.regions[0].position).toEqual({ x: -10, y: 105 });
  });

  it("rounds a half-pixel center UP (Math.round, not floor/trunc)", () => {
    // viewport 1001×801 → center {500.5, 400.5}; default size 420×140
    insertBlock(makeDef(), { w: 1001, h: 801 });
    // round(500.5-210)=round(290.5)=291 ; round(400.5-70)=round(330.5)=331
    expect(useWorkspaceStore.getState().doc.regions[0].position).toEqual({ x: 291, y: 331 });
  });

  it("is append-only: a 2nd insert adds a 2nd region, keeps the 1st, reselects the new block", () => {
    insertBlock(makeDef(), { w: 1000, h: 800 });
    const firstBlockId = useWorkspaceStore.getState().doc.regions[0].blocks[0].id;

    insertBlock(makeDef({ type: "list", label: "List" }), { w: 1000, h: 800 });

    const doc = useWorkspaceStore.getState().doc;
    expect(doc.regions).toHaveLength(2);
    expect(doc.regions[0].blocks[0].id).toBe(firstBlockId); // old region untouched
    const secondBlockId = doc.regions[1].blocks[0].id;
    expect(secondBlockId).not.toBe(firstBlockId);
    expect(doc.regions[1].title).toBe("List");
    expect(useUiStore.getState().selectedIds).toEqual([secondBlockId]);
  });
});

describe("insertBlock — defensive guards (fault-injected store seam)", () => {
  it("created region is not findable → no selection, no throw, but pos was still computed+moved", () => {
    const real = useWorkspaceStore.getState();
    const fake = {
      ...real,
      createRegion: () => "region_ghost",
      moveRegion: vi.fn(),
      doc: { ...real.doc, regions: [] }, // find(rid) → undefined  ⇒  region?. nullish
    } as unknown as WorkspaceState;
    vi.spyOn(useWorkspaceStore, "getState").mockReturnValue(fake);

    expect(() => insertBlock(makeDef(), { w: 1000, h: 800 })).not.toThrow();
    expect(useUiStore.getState().selectedIds).toEqual([]); // if (blockId) false → no select
    expect(fake.moveRegion).toHaveBeenCalledWith("region_ghost", { x: 290, y: 330 });
  });

  it("region exists but has zero blocks → blocks[0]?.id undefined → no selection, no throw", () => {
    const real = useWorkspaceStore.getState();
    const ghost: Region = {
      id: "region_ghost2", title: "x", position: { x: 0, y: 0 }, size: { w: 1, h: 1 },
      blocks: [], createdAt: 1,
    };
    const fake = {
      ...real,
      createRegion: () => "region_ghost2",
      moveRegion: vi.fn(),
      doc: { ...real.doc, regions: [ghost] },
    } as unknown as WorkspaceState;
    vi.spyOn(useWorkspaceStore, "getState").mockReturnValue(fake);

    expect(() => insertBlock(makeDef(), { w: 1000, h: 800 })).not.toThrow();
    expect(useUiStore.getState().selectedIds).toEqual([]);
  });
});

describe("pasteBlock — success paths (whole real pipeline)", () => {
  it("empty clipboard → early return: no region created, no selection", () => {
    vi.spyOn(blockClipboard, "get").mockReturnValue(null);
    pasteBlock({ w: 1000, h: 800 });
    expect(useWorkspaceStore.getState().doc.regions).toEqual([]);
    expect(useUiStore.getState().selectedIds).toEqual([]);
  });

  it("pastes clipboard block as a NEW offset (+20,+20) region with its type/size/data, then selects it", () => {
    const src: BlockInstance = {
      id: "block_src", type: "table", z: 3,
      position: { x: 11, y: 22 }, size: { w: 200, h: 100 }, data: { rows: [[1, 2]] },
    };
    blockClipboard.copy(src); // real clipboard (deep-copies in/out)

    pasteBlock({ w: 1000, h: 800 });

    const doc = useWorkspaceStore.getState().doc;
    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.title).toBe("table"); // createRegion(src.type) — no label concept for paste
    expect(region.size).toEqual({ w: 200, h: 100 });
    // c = {500,400}; pos = round(500-100+20)=420, round(400-50+20)=370
    expect(region.position).toEqual({ x: 420, y: 370 });

    const block = region.blocks[0];
    expect(block.type).toBe("table");
    expect(block.position).toEqual({ x: 0, y: 0 }); // reset to region-local, NOT src.position
    expect(block.size).toEqual({ w: 200, h: 100 });
    expect(block.data).toEqual({ rows: [[1, 2]] });
    expect(block.id).not.toBe("block_src"); // freshly minted id, not the source's
    expect(useUiStore.getState().selectedIds).toEqual([block.id]);
  });

  it("computes paste position through the REAL screenToWorld with a zoomed+offset camera", () => {
    useCameraStore.setState({ camera: { x: 40, y: 60, scale: 2 } });
    const src: BlockInstance = {
      id: "b", type: "text", z: 1, position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, data: {},
    };
    blockClipboard.copy(src);

    pasteBlock({ w: 1000, h: 800 });
    // c = {(500-40)/2=230, (400-60)/2=170}; pos = round(230-50+20)=200, round(170-40+20)=150
    expect(useWorkspaceStore.getState().doc.regions[0].position).toEqual({ x: 200, y: 150 });
  });
});

describe("pasteBlock — defensive guards (fault-injected store seam)", () => {
  it("pasted region is not findable → no selection, no throw, but pos was still computed+moved", () => {
    const src: BlockInstance = {
      id: "b", type: "text", z: 1, position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, data: {},
    };
    vi.spyOn(blockClipboard, "get").mockReturnValue(src);
    const real = useWorkspaceStore.getState();
    const fake = {
      ...real,
      createRegion: () => "region_ghost3",
      moveRegion: vi.fn(),
      doc: { ...real.doc, regions: [] },
    } as unknown as WorkspaceState;
    vi.spyOn(useWorkspaceStore, "getState").mockReturnValue(fake);

    expect(() => pasteBlock({ w: 1000, h: 800 })).not.toThrow();
    expect(useUiStore.getState().selectedIds).toEqual([]);
    // size 100×80, camera {0,0,1}: pos = round(500-50+20)=470, round(400-40+20)=380
    expect(fake.moveRegion).toHaveBeenCalledWith("region_ghost3", { x: 470, y: 380 });
  });

  it("pasted region exists but has zero blocks → blocks[0]?.id undefined → no selection", () => {
    const src: BlockInstance = {
      id: "b", type: "text", z: 1, position: { x: 0, y: 0 }, size: { w: 100, h: 80 }, data: {},
    };
    vi.spyOn(blockClipboard, "get").mockReturnValue(src);
    const real = useWorkspaceStore.getState();
    const ghost: Region = {
      id: "region_ghost4", title: "t", position: { x: 0, y: 0 }, size: { w: 1, h: 1 },
      blocks: [], createdAt: 1,
    };
    const fake = {
      ...real,
      createRegion: () => "region_ghost4",
      moveRegion: vi.fn(),
      doc: { ...real.doc, regions: [ghost] },
    } as unknown as WorkspaceState;
    vi.spyOn(useWorkspaceStore, "getState").mockReturnValue(fake);

    expect(() => pasteBlock({ w: 1000, h: 800 })).not.toThrow();
    expect(useUiStore.getState().selectedIds).toEqual([]);
  });
});
