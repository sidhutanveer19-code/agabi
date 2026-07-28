import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BlockInstance } from "@/features/workspace/types";

/**
 * blockClipboard — in-memory dev-authoring block clipboard.
 *
 * There is NO I/O edge here (no db/network/clock/fetch) — the module is pure
 * logic: a module-level `clip` singleton plus a structured deep-clone via
 * `JSON.parse(JSON.stringify(...))` on BOTH copy and get. So nothing is mocked
 * away; instead `vi.resetModules()` + a fresh dynamic import per test resets the
 * `clip` singleton to its `null` initial state so every branch is exercised in a
 * disposable, order-independent env (H1.6 REAL + ISOLATED).
 *
 * Branches / edges under test (every one asserts the REAL result, never "ran"):
 *   - has():  clip === null  → false   (fresh module)    AND  clip !== null → true (after copy)
 *   - get():  ternary FALSE branch (clip null → returns null literal)
 *   - get():  ternary TRUE  branch (clip set → returns a FRESH deep clone)
 *   - copy(): deep clone on WRITE — mutating the source after copy cannot reach the snapshot
 *   - get():  deep clone on READ  — mutating a returned value cannot reach the snapshot
 *   - get():  distinct reference every call (top-level AND nested), never the stored object
 *   - copy(): overwrites the previous clip (last write wins)
 *   - JSON deep-clone edges: `undefined` object keys dropped; `undefined` array holes → null
 */

type Clipboard = (typeof import("@/features/workspace/blocks/shared/clipboard"))["blockClipboard"];

let blockClipboard: Clipboard;

beforeEach(async () => {
  // Reset the module-level `clip` singleton to its initial `null` so the
  // empty-state branches are reachable deterministically regardless of order.
  vi.resetModules();
  blockClipboard = (await import("@/features/workspace/blocks/shared/clipboard")).blockClipboard;
});

function makeBlock(over: Partial<BlockInstance> = {}): BlockInstance {
  return {
    id: "b1",
    type: "text",
    position: { x: 10, y: 20 },
    size: { w: 100, h: 50 },
    z: 3,
    data: { text: "hello", items: [1, 2, 3], meta: { bold: true } },
    ...over,
  };
}

describe("blockClipboard — empty (initial null) state", () => {
  it("has() → false when nothing has been copied (clip === null branch)", () => {
    expect(blockClipboard.has()).toBe(false);
  });

  it("get() → null when nothing has been copied (ternary FALSE branch)", () => {
    expect(blockClipboard.get()).toBeNull();
  });
});

describe("blockClipboard — after copy()", () => {
  it("has() → true once a block is copied (clip !== null branch)", () => {
    blockClipboard.copy(makeBlock());
    expect(blockClipboard.has()).toBe(true);
  });

  it("get() → a value DEEP-EQUAL to the copied block (ternary TRUE branch)", () => {
    const block = makeBlock();
    blockClipboard.copy(block);
    expect(blockClipboard.get()).toEqual(block);
  });

  it("get() returns a fresh object, not the original reference — nested too", () => {
    const block = makeBlock();
    blockClipboard.copy(block);

    const got = blockClipboard.get();
    expect(got).not.toBeNull();
    expect(got).not.toBe(block); // top-level clone
    expect(got!.position).not.toBe(block.position); // nested clone
    expect(got!.size).not.toBe(block.size);
    expect(got!.data).not.toBe(block.data);
    expect(got).toEqual(block); // ...but structurally identical
  });

  it("has() stays true after get() — get() does not consume/clear the clip", () => {
    blockClipboard.copy(makeBlock());
    expect(blockClipboard.has()).toBe(true);
    blockClipboard.get();
    expect(blockClipboard.has()).toBe(true);
  });
});

describe("blockClipboard — deep-clone isolation (the whole point of the module)", () => {
  it("clone-on-WRITE: mutating the SOURCE after copy() cannot reach the stored snapshot", () => {
    const block = makeBlock();
    blockClipboard.copy(block);

    // Mutate the caller's original object AFTER the copy.
    block.position.x = 999;
    block.z = -7;
    (block.data as { text: string; items: number[] }).text = "changed";
    (block.data as { text: string; items: number[] }).items.push(4);

    const got = blockClipboard.get()!;
    expect(got.position.x).toBe(10); // original snapshot value, not 999
    expect(got.z).toBe(3); // not -7
    expect((got.data as { text: string; items: number[] }).text).toBe("hello");
    expect((got.data as { text: string; items: number[] }).items).toEqual([1, 2, 3]);
  });

  it("clone-on-READ: mutating a value returned by get() cannot reach the stored snapshot", () => {
    blockClipboard.copy(makeBlock());

    const first = blockClipboard.get()!;
    first.position.x = -1;
    first.id = "tampered";
    (first.data as { items: number[] }).items.push(999);

    const second = blockClipboard.get()!;
    expect(second.position.x).toBe(10); // unchanged by the mutation of `first`
    expect(second.id).toBe("b1");
    expect((second.data as { items: number[] }).items).toEqual([1, 2, 3]);
  });

  it("each get() yields a brand-new deep copy — never the same reference across calls", () => {
    blockClipboard.copy(makeBlock());

    const a = blockClipboard.get()!;
    const b = blockClipboard.get()!;
    expect(a).not.toBe(b); // distinct top-level objects
    expect(a.position).not.toBe(b.position); // distinct nested objects
    expect(a.data).not.toBe(b.data);
    expect(a).toEqual(b); // yet structurally identical
  });
});

describe("blockClipboard — overwrite semantics (last write wins)", () => {
  it("a second copy() replaces the first; get() returns the newest block", () => {
    blockClipboard.copy(makeBlock({ id: "A", data: { v: "first" } }));
    blockClipboard.copy(makeBlock({ id: "B", data: { v: "second" } }));

    expect(blockClipboard.has()).toBe(true);
    const got = blockClipboard.get()!;
    expect(got.id).toBe("B");
    expect((got.data as { v: string }).v).toBe("second");
  });
});

describe("blockClipboard — JSON deep-clone edges (real serialization behaviour)", () => {
  it("object keys whose value is `undefined` are dropped by the JSON round-trip", () => {
    const block = makeBlock({ data: { keep: 1, drop: undefined, nested: { a: undefined, b: 2 } } });
    blockClipboard.copy(block);

    const got = blockClipboard.get()!;
    expect(got.data).toEqual({ keep: 1, nested: { b: 2 } });
    expect("drop" in (got.data as object)).toBe(false);
    expect("a" in (got.data as { nested: object }).nested).toBe(false);
  });

  it("`undefined` array holes become `null` (JSON.stringify coercion)", () => {
    const block = makeBlock({ data: { arr: [1, undefined, 3] } });
    blockClipboard.copy(block);

    const got = blockClipboard.get()!;
    expect((got.data as { arr: unknown[] }).arr).toEqual([1, null, 3]);
  });
});
