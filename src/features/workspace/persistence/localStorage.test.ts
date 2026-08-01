import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * localWorkspacePersistence — the localStorage-backed WorkspacePersistence.
 *
 * The ONLY I/O edge is `window.localStorage`; it is faked here with a
 * configurable in-memory `FakeStorage` (via `vi.stubGlobal`) that can be told to
 * throw on `getItem` / `setItem` / `key` to exercise the defensive catch clauses.
 * Everything else runs for REAL — `serialize` / `deserialize` (versioned zod +
 * per-block validation) and `cameraSchema.safeParse` are the true production
 * logic, never mocked. Every assertion names the exact expected value (the stored
 * bytes, the round-tripped document, `null`, or the surviving key set) and asserts
 * THAT — never "it didn't throw".
 *
 * Branches under test:
 *   saveDoc     — success writes serialize(doc) under the s{VERSION} key; setItem throw → swallowed, nothing written
 *   loadDoc     — purgeLegacy runs first; raw present → deserialize (valid → doc, corrupt/incompatible → null);
 *                 raw absent → null (ternary false); getItem throw → catch → null
 *   purgeLegacy — legacy prefix match → removed (both prefixes); non-legacy retained; empty-string key skipped
 *                 (k && short-circuit); current s{VERSION} key never purged; key() throw → catch → no-op, load still works
 *   saveCamera  — success writes JSON.stringify(camera); setItem throw → swallowed
 *   loadCamera  — !raw → null; valid → parsed.data (extras stripped by zod); bad shape/type → null (safeParse false);
 *                 invalid JSON → catch → null; getItem throw → catch → null
 */

import { localWorkspacePersistence } from "@/features/workspace/persistence/localStorage";
import { serialize } from "@/features/workspace/serialization/serialize";
import type { WorkspaceDoc, Camera } from "@/features/workspace/types";
import { SCHEMA_VERSION } from "@/features/workspace/types";

const NS = `agabi:ws:s${SCHEMA_VERSION}`;
const docKey = (id: string) => `${NS}:doc:${id}`;
const camKey = (id: string) => `${NS}:cam:${id}`;

/**
 * In-memory Storage stand-in for the ONE I/O boundary. Insertion-ordered like a
 * real Storage; the `throwOn*` flags simulate a browser that has disabled/blocked
 * localStorage (private mode, quota) so the defensive `catch` paths are reached.
 * `peek` / `seed` / `allKeys` are test-only inspectors that bypass the flags so
 * assertions can read the true stored state even when a throw flag is armed.
 */
class FakeStorage {
  private data = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;
  throwOnKey = false;

  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    if (this.throwOnKey) throw new Error("key() blocked");
    return [...this.data.keys()][index] ?? null;
  }
  getItem(k: string): string | null {
    if (this.throwOnGet) throw new Error("getItem blocked");
    return this.data.has(k) ? (this.data.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.throwOnSet) throw new Error("QuotaExceededError");
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  // ---- test-only inspection (never throws, ignores flags) ----
  peek(k: string): string | null {
    return this.data.has(k) ? (this.data.get(k) as string) : null;
  }
  seed(k: string, v: string): void {
    this.data.set(k, v);
  }
  allKeys(): string[] {
    return [...this.data.keys()];
  }
}

let store: FakeStorage;

beforeEach(() => {
  store = new FakeStorage();
  vi.stubGlobal("window", { localStorage: store });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fully-populated, valid v{SCHEMA_VERSION} document that round-trips cleanly. */
function makeDoc(id = "doc-1"): WorkspaceDoc {
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    topic: "Newton's Laws",
    regions: [
      {
        id: "r1",
        title: "Explanation A",
        position: { x: 0, y: 0 },
        size: { w: 640, h: 480 },
        createdAt: 1000,
        accent: "#abcdef",
        blocks: [
          {
            id: "b1",
            // unregistered type in the unit env → deserialize keeps it (def?.schema is undefined)
            type: "unknown-widget",
            position: { x: 12, y: 34 },
            size: { w: 100, h: 50 },
            z: 3,
            data: { foo: "bar", n: 42, nested: { ok: true } },
          },
        ],
      },
    ],
    createdAt: 500,
    updatedAt: 600,
  };
}

describe("localWorkspacePersistence.saveDoc", () => {
  it("writes serialize(doc) under the SCHEMA_VERSION-namespaced doc key", () => {
    const doc = makeDoc("w1");
    localWorkspacePersistence.saveDoc("w1", doc);

    // exact bytes = the real serialize() output, under the exact versioned key
    expect(store.peek(docKey("w1"))).toBe(serialize(doc));
    expect(store.allKeys()).toEqual([`agabi:ws:s${SCHEMA_VERSION}:doc:w1`]);
    // the versioned key must NOT collide with the legacy (unversioned) namespace
    expect(store.allKeys()).not.toContain("agabi:ws:doc:w1");
  });

  it("setItem throwing is swallowed — nothing is written, no error propagates", () => {
    store.throwOnSet = true;
    expect(() => localWorkspacePersistence.saveDoc("w1", makeDoc("w1"))).not.toThrow();
    expect(store.peek(docKey("w1"))).toBeNull();
    expect(store.allKeys()).toEqual([]);
  });
});

describe("localWorkspacePersistence.loadDoc + purgeLegacy", () => {
  it("round-trips a saved document back to a deep-equal (but fresh) object", async () => {
    const doc = makeDoc("w1");
    localWorkspacePersistence.saveDoc("w1", doc);

    // `loadDoc` is typed sync-or-async (the persistence seam) — await narrows the union.
    const loaded = await localWorkspacePersistence.loadDoc("w1");
    expect(loaded).toEqual(doc);
    // proof it went through serialize→deserialize, not the same reference
    expect(loaded).not.toBe(doc);
    expect(loaded?.regions[0].blocks[0].data).toEqual({ foo: "bar", n: 42, nested: { ok: true } });
  });

  it("absent key → null (the `raw ? … : null` false branch)", () => {
    expect(localWorkspacePersistence.loadDoc("never-saved")).toBeNull();
  });

  it("corrupt stored JSON → deserialize returns null → loadDoc returns null", () => {
    store.seed(docKey("w1"), "{ this is not valid json");
    expect(localWorkspacePersistence.loadDoc("w1")).toBeNull();
  });

  it("stored doc with an incompatible schemaVersion → deserialize rejects → null", () => {
    const stale = { ...makeDoc("w1"), schemaVersion: SCHEMA_VERSION - 1 };
    store.seed(docKey("w1"), JSON.stringify(stale));
    expect(localWorkspacePersistence.loadDoc("w1")).toBeNull();
  });

  it("getItem throwing → catch → null (purgeLegacy already ran, separately guarded)", () => {
    store.seed(docKey("w1"), serialize(makeDoc("w1")));
    store.throwOnGet = true;
    expect(localWorkspacePersistence.loadDoc("w1")).toBeNull();
  });

  it("purges ONLY legacy-namespaced keys, keeps current + unrelated + empty-string keys, and still loads the doc", () => {
    const doc = makeDoc("keep");
    store.seed("agabi:ws:doc:old", "legacy-doc"); // legacy prefix #1 → purge
    store.seed("agabi:ws:cam:old2", "legacy-cam"); // legacy prefix #2 → purge
    store.seed(docKey("keep"), serialize(doc)); // current versioned key → survives
    store.seed("some:other:key", "unrelated"); // no legacy prefix → survives (some → false)
    store.seed("", "empty-key"); // falsy key → skipped by `k &&` short-circuit

    const loaded = localWorkspacePersistence.loadDoc("keep");
    expect(loaded).toEqual(doc);

    const remaining = store.allKeys();
    expect(remaining).not.toContain("agabi:ws:doc:old");
    expect(remaining).not.toContain("agabi:ws:cam:old2");
    expect(remaining).toContain(docKey("keep"));
    expect(remaining).toContain("some:other:key");
    expect(remaining).toContain(""); // empty-string key untouched
  });

  it("purgeLegacy is best-effort: key() throwing is swallowed, legacy stays, load still works", () => {
    const doc = makeDoc("keep");
    store.seed("agabi:ws:doc:old", "legacy-doc");
    store.seed(docKey("keep"), serialize(doc));
    store.throwOnKey = true; // enumeration blows up inside purgeLegacy

    const loaded = localWorkspacePersistence.loadDoc("keep");
    expect(loaded).toEqual(doc); // getItem still works → doc loads
    // purge was aborted mid-scan → the legacy key was NOT removed
    expect(store.allKeys()).toContain("agabi:ws:doc:old");
  });
});

describe("localWorkspacePersistence.saveCamera", () => {
  it("writes JSON.stringify(camera) under the SCHEMA_VERSION-namespaced cam key", () => {
    const cam: Camera = { x: 10, y: -20, scale: 1.5 };
    localWorkspacePersistence.saveCamera("w1", cam);

    expect(store.peek(camKey("w1"))).toBe(JSON.stringify(cam));
    expect(store.allKeys()).toEqual([`agabi:ws:s${SCHEMA_VERSION}:cam:w1`]);
  });

  it("setItem throwing is swallowed — nothing written, no error propagates", () => {
    store.throwOnSet = true;
    expect(() =>
      localWorkspacePersistence.saveCamera("w1", { x: 1, y: 2, scale: 1 }),
    ).not.toThrow();
    expect(store.peek(camKey("w1"))).toBeNull();
    expect(store.allKeys()).toEqual([]);
  });
});

describe("localWorkspacePersistence.loadCamera", () => {
  it("round-trips a saved camera to a deep-equal object", () => {
    const cam: Camera = { x: 3.5, y: 7, scale: 2 };
    localWorkspacePersistence.saveCamera("w1", cam);
    expect(localWorkspacePersistence.loadCamera("w1")).toEqual(cam);
  });

  it("valid camera with EXTRA keys → zod strips them → returns only {x,y,scale}", () => {
    store.seed(camKey("w1"), JSON.stringify({ x: 1, y: 2, scale: 1.5, hacker: "nope", z: 99 }));
    expect(localWorkspacePersistence.loadCamera("w1")).toEqual({ x: 1, y: 2, scale: 1.5 });
  });

  it("absent key → null (the `if (!raw) return null` branch)", () => {
    expect(localWorkspacePersistence.loadCamera("never-saved")).toBeNull();
  });

  it("valid JSON of the WRONG shape (missing scale) → safeParse fails → null", () => {
    store.seed(camKey("w1"), JSON.stringify({ x: 1, y: 2 }));
    expect(localWorkspacePersistence.loadCamera("w1")).toBeNull();
  });

  it("valid JSON with a wrong-typed field (scale as string) → safeParse fails → null", () => {
    store.seed(camKey("w1"), JSON.stringify({ x: 1, y: 2, scale: "3" }));
    expect(localWorkspacePersistence.loadCamera("w1")).toBeNull();
  });

  it("invalid JSON → JSON.parse throws → catch → null", () => {
    store.seed(camKey("w1"), "{ not json");
    expect(localWorkspacePersistence.loadCamera("w1")).toBeNull();
  });

  it("getItem throwing → catch → null", () => {
    store.seed(camKey("w1"), JSON.stringify({ x: 1, y: 2, scale: 1 }));
    store.throwOnGet = true;
    expect(localWorkspacePersistence.loadCamera("w1")).toBeNull();
  });
});
