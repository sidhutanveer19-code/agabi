import { describe, it, expect, beforeEach } from "vitest";
import type { StreamedBlock } from "@contract";
import type { Region, Vec2, Size, WorkspaceDoc } from "@/features/workspace/types";
import { useWorkspaceStore, emptyDoc } from "@/features/workspace/stores/workspace.store";
import { openRegion, addStreamedBlock, PAD, CONTENT_W, GAP } from "@/features/workspace/ai/streamRegion";

/**
 * openRegion / addStreamedBlock / blockHeight (private, exercised through
 * addStreamedBlock) — the frontend lesson-layout seam that turns streamed blocks
 * into placed regions/blocks in the workspace store.
 *
 * There is NO I/O edge in this module (no prisma/db/network/fetch/clock). Its only
 * dependencies are the REAL in-memory zustand `useWorkspaceStore` and the REAL pure
 * `placeExplanation`→`placeRegion` geometry. Per §H1.6/§H1.7 the strict choice is to
 * run them for real (a mock would only prove the mock) and isolate each test with a
 * fresh empty document. Every assertion names the EXACT geometry/id the module must
 * produce — never "it ran".
 *
 * Branches covered:
 *   - blockHeight: known type (HEIGHT[type]) AND unknown type (?? 140 fallback)
 *   - openRegion: first-of-title (prior.length === 0 → placeExplanation branch)
 *   - openRegion: flow-on (prior.length >= 1 → { prior[0].x, max(bottom)+GAP } branch)
 *   - openRegion: Math.max spread over MULTIPLE priors + norm() case/trim + filter exclusion
 *   - addStreamedBlock: cursor threading + region growth across appends; streamText dropped
 */

function getDoc(): WorkspaceDoc {
  return useWorkspaceStore.getState().doc;
}
function getRegion(id: string): Region {
  const r = getDoc().regions.find((x) => x.id === id);
  if (!r) throw new Error(`region ${id} not found`);
  return r;
}
function mkRegion(id: string, title: string, position: Vec2, size: Size, createdAt: number): Region {
  return { id, title, position, size, blocks: [], createdAt };
}

beforeEach(() => {
  // Fresh, empty document per test — real store, isolated state.
  useWorkspaceStore.setState({ doc: emptyDoc() });
});

describe("streamRegion — layout constants (locked geometry)", () => {
  it("PAD/CONTENT_W/GAP are the exact values the layout math depends on", () => {
    expect(PAD).toBe(26);
    expect(CONTENT_W).toBe(660);
    expect(GAP).toBe(16);
  });
});

describe("openRegion — first region of a title (placeExplanation branch)", () => {
  it("creates the region at the non-overlapping placeExplanation slot with the lesson-column size", () => {
    const result = openRegion("Photosynthesis");

    // Return shape is EXACTLY { id }.
    expect(Object.keys(result)).toEqual(["id"]);
    expect(typeof result.id).toBe("string");

    const doc = getDoc();
    expect(doc.regions).toHaveLength(1);
    const region = getRegion(result.id);
    expect(region.title).toBe("Photosynthesis");

    // Region size = { w: CONTENT_W + PAD*2, h: PAD*2 + 40 } = { 712, 92 }.
    expect(region.size).toEqual({ w: 712, h: 92 });

    // prior is empty → placeExplanation({ w: 712, h: 460 }). createRegion already
    // inserted this region at {0,0}; placeExplanation then scans for a 712x460 slot
    // that does not overlap that just-placed 712x92 footprint. Row 0 / col 0 (x=0)
    // overlaps it; col 1 lands at x = 712 + GAP48 = 760, y = 0. That is the real,
    // deterministic result — assert it exactly.
    expect(region.position).toEqual({ x: 760, y: 0 });
  });
});

describe("openRegion — flow-on placement (prior branch, real end-to-end)", () => {
  it("a second region of the SAME title stacks directly beneath the first (prior[0].x, max bottom + GAP)", () => {
    const first = openRegion("Algebra");
    const firstRegion = getRegion(first.id);
    // Sanity: first is at the placeExplanation slot computed above.
    expect(firstRegion.position).toEqual({ x: 760, y: 0 });
    expect(firstRegion.size).toEqual({ w: 712, h: 92 });

    const second = openRegion("Algebra");
    expect(getDoc().regions).toHaveLength(2);

    const secondRegion = getRegion(second.id);
    // x inherited from prior[0]; y = max(prior bottom = 0 + 92) + GAP(16) = 108.
    expect(secondRegion.position).toEqual({ x: 760, y: 108 });
    expect(secondRegion.size).toEqual({ w: 712, h: 92 });
    // Distinct region ids (append-only, never overwrite).
    expect(second.id).not.toBe(first.id);
  });
});

describe("openRegion — Math.max over multiple priors + norm() case/trim + filter exclusion", () => {
  it("uses prior[0].x and the LOWEST bottom of all matching-title priors; ignores other titles", () => {
    // Seed: two 'Cells' regions (different x, different bottoms) + one 'Mitosis'
    // distractor far below. If norm-filtering were broken and included 'Mitosis'
    // (bottom 1200), y would be 1216 — asserting 266 proves it is excluded.
    const seeded: WorkspaceDoc = {
      ...emptyDoc(),
      regions: [
        mkRegion("rgn_a", "Cells", { x: 100, y: 0 }, { w: 712, h: 92 }, 1), // bottom 92
        mkRegion("rgn_b", "Cells", { x: 300, y: 50 }, { w: 712, h: 200 }, 2), // bottom 250
        mkRegion("rgn_c", "Mitosis", { x: 0, y: 1000 }, { w: 712, h: 200 }, 3), // bottom 1200
      ],
    };
    useWorkspaceStore.setState({ doc: seeded });

    // Mixed case + surrounding whitespace → norm() must still match 'Cells'.
    const result = openRegion("  CELLS  ");

    expect(getDoc().regions).toHaveLength(4);
    const region = getRegion(result.id);
    // Raw (un-normalized) title is stored as given.
    expect(region.title).toBe("  CELLS  ");
    // x = prior[0].x = 100 (region A), NOT 300 (B) or 0 (C).
    // y = max(92, 250) + GAP(16) = 266 — proves Math.max spans BOTH priors and excludes C.
    expect(region.position).toEqual({ x: 100, y: 266 });
    expect(region.size).toEqual({ w: 712, h: 92 });
  });
});

describe("addStreamedBlock — known height, exact block, region growth", () => {
  it("places a 'paragraph' (height 104) at cursor 0 and grows the region to enclose it", () => {
    const { id } = openRegion("Cells");
    const block: StreamedBlock = { type: "paragraph", data: { text: "Sunlight → sugar" } };

    const res = addStreamedBlock(id, block, 0);

    // Return shape is EXACTLY { blockId, nextCursor }.
    expect(Object.keys(res).sort()).toEqual(["blockId", "nextCursor"]);
    expect(typeof res.blockId).toBe("string");
    // nextCursor = cursor(0) + height(104) + GAP(16) = 120.
    expect(res.nextCursor).toBe(120);

    const region = getRegion(id);
    expect(region.blocks).toHaveLength(1);
    const b = region.blocks[0];
    expect(b.id).toBe(res.blockId);
    expect(b.type).toBe("paragraph");
    // position = { x: PAD(26), y: cursor(0) }; size = { w: CONTENT_W(660), h: 104 }.
    expect(b.position).toEqual({ x: 26, y: 0 });
    expect(b.size).toEqual({ w: 660, h: 104 });
    expect(b.data).toEqual({ text: "Sunlight → sugar" });

    // Region regrows: { w: CONTENT_W + PAD*2 (712), h: nextCursor(120) + PAD(26) = 146 }.
    expect(region.size).toEqual({ w: 712, h: 146 });
  });
});

describe("addStreamedBlock — unknown type falls back to height 140", () => {
  it("an unregistered type uses the 140 default and offsets by the given cursor", () => {
    const { id } = openRegion("Cells");
    const block: StreamedBlock = { type: "totally-unknown-xyz", data: { k: 1 } };

    const res = addStreamedBlock(id, block, 200);

    // nextCursor = 200 + 140 + 16 = 356.
    expect(res.nextCursor).toBe(356);

    const b = getRegion(id).blocks[0];
    expect(b.type).toBe("totally-unknown-xyz");
    expect(b.position).toEqual({ x: 26, y: 200 });
    expect(b.size).toEqual({ w: 660, h: 140 });

    // Region h = nextCursor(356) + PAD(26) = 382.
    expect(getRegion(id).size).toEqual({ w: 712, h: 382 });
  });
});

describe("addStreamedBlock — cursor threading across appends; streamText is dropped", () => {
  it("second append starts at the returned cursor and stacks; streamText is not persisted", () => {
    const { id } = openRegion("Cells");

    const first = addStreamedBlock(id, { type: "paragraph", data: { t: "a" } }, 0);
    expect(first.nextCursor).toBe(120); // 0 + 104 + 16

    // Feed the returned cursor back in (real streaming thread). 'heading' height = 60.
    // streamText present on the wire block — the module maps ONLY type + data.
    const heading: StreamedBlock = { type: "heading", data: { level: 2 }, streamText: "tok…" };
    const second = addStreamedBlock(id, heading, first.nextCursor);
    // nextCursor = 120 + 60 + 16 = 196.
    expect(second.nextCursor).toBe(196);

    const region = getRegion(id);
    expect(region.blocks).toHaveLength(2);

    const b2 = region.blocks[1];
    expect(b2.id).toBe(second.blockId);
    expect(b2.type).toBe("heading");
    expect(b2.position).toEqual({ x: 26, y: 120 });
    expect(b2.size).toEqual({ w: 660, h: 60 });
    expect(b2.data).toEqual({ level: 2 });
    // streamText was NOT carried onto the stored block.
    expect("streamText" in b2).toBe(false);

    // Region grew to enclose the second block: h = 196 + PAD(26) = 222.
    expect(region.size).toEqual({ w: 712, h: 222 });
    // Distinct ids for the two appended blocks.
    expect(second.blockId).not.toBe(first.blockId);
  });
});
