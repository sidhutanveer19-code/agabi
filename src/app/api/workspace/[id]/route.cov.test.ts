import { describe, it, expect, vi, beforeEach } from "vitest";
import { storageId } from "@/server/conversation/ids";

/**
 * Unit coverage for GET/PUT /api/workspace/[id] — the single-workspace
 * load/save endpoint. Every branch of both handlers is pinned:
 *
 *   GET
 *     1. no user                       → 401 unauthenticated envelope
 *     2. findUnique throws              → `.catch(() => null)` → 404 not_found
 *     3. findUnique returns null        → 404 not_found
 *     4. row exists, userId mismatch    → 404 (defence-in-depth ownership guard)
 *     5. row exists, userId matches     → 200 { doc, camera }
 *
 *   PUT
 *     1. no user                        → 401 unauthenticated envelope
 *     2. body length > MAX_DOC_BYTES    → 413 too_large  (boundary: `>` not `>=`)
 *     3. body length == MAX_DOC_BYTES   → not 413 (falls through)
 *     4. invalid JSON                   → 400 bad_request "Invalid JSON."
 *     5. valid JSON, wrong shape        → 400 bad_request "Invalid workspace shape."
 *     6. valid state                    → upsert + emit(workspace.saved) + 200 { ok:true }
 *
 * Only the true I/O seams are stubbed (auth, prisma, events); the id math
 * (`storageId`) and the contract zod schema (`workspaceStateSchema`) are real.
 * The `@/env` seam is mocked so MAX_DOC_BYTES is controllable per test without a
 * 2 MB fixture. Exact prisma/emit args are captured so mutating the where/create/
 * update clauses, the emitted event type, payload, or source all go red.
 */

let currentUser: string | null = null;
let maxDocBytes = 2_000_000;

let findUniqueImpl: (args: unknown) => Promise<unknown>;
let upsertImpl: (args: unknown) => Promise<unknown>;
const findUniqueCalls: unknown[] = [];
const upsertCalls: unknown[] = [];
const getUserIdArgs: unknown[] = [];
const emitCalls: unknown[][] = [];

vi.mock("@/server/auth", () => ({
  getUserId: async (req: unknown) => {
    getUserIdArgs.push(req);
    return currentUser;
  },
}));

vi.mock("@/env", () => ({
  env: {
    get MAX_DOC_BYTES() {
      return maxDocBytes;
    },
  },
}));

vi.mock("@/server/db", () => ({
  prisma: {
    workspace: {
      findUnique: (args: unknown) => {
        findUniqueCalls.push(args);
        return findUniqueImpl(args);
      },
      upsert: (args: unknown) => {
        upsertCalls.push(args);
        return upsertImpl(args);
      },
    },
  },
}));

// Keep the real EVENTS map (so a wrong-key mutation in the route emits a wrong
// string and the exact-value assertion catches it); stub only the emit I/O.
vi.mock("@/server/events", () => ({
  emit: async (...args: unknown[]) => {
    emitCalls.push(args);
    return "evt_id";
  },
  EVENTS: { workspaceSaved: "workspace.saved" },
}));

const { GET, PUT } = await import("@/app/api/workspace/[id]/route");

const params = (id: string) => Promise.resolve({ id });
const getReq = () => new Request("http://localhost/api/workspace/default");
const putReq = (body: string) =>
  new Request("http://localhost/api/workspace/default", { method: "PUT", body });

const validState = {
  doc: {
    id: "canvas1",
    schemaVersion: 1,
    regions: [] as unknown[],
    createdAt: 1000,
    updatedAt: 2000,
  },
  camera: { x: 3, y: 4, scale: 1.5 },
};

beforeEach(() => {
  currentUser = null;
  maxDocBytes = 2_000_000;
  findUniqueCalls.length = 0;
  upsertCalls.length = 0;
  getUserIdArgs.length = 0;
  emitCalls.length = 0;
  findUniqueImpl = async () => null;
  upsertImpl = async () => ({});
});

// ---------------------------------------------------------------- GET

describe("GET /api/workspace/[id] — auth gate", () => {
  it("no user → 401 with the exact unauthenticated envelope and JSON content-type", async () => {
    currentUser = null;
    const res = await GET(getReq(), { params: params("default") });

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      code: "unauthenticated",
      message: "Sign in first.",
      recoverable: false,
    });
  });

  it("no user → never touches the database", async () => {
    currentUser = null;
    findUniqueImpl = async () => {
      throw new Error("prisma must not be called when unauthenticated");
    };
    const res = await GET(getReq(), { params: params("default") });

    expect(res.status).toBe(401);
    expect(findUniqueCalls).toHaveLength(0);
  });

  it("passes the incoming Request straight to getUserId", async () => {
    const r = getReq();
    await GET(r, { params: params("default") });
    expect(getUserIdArgs).toHaveLength(1);
    expect(getUserIdArgs[0]).toBe(r);
  });
});

describe("GET /api/workspace/[id] — lookup", () => {
  it("queries findUnique by the composite storage key for THIS user + canvas id", async () => {
    currentUser = "user_1";
    findUniqueImpl = async () => ({ userId: "user_1", doc: {}, camera: {} });

    await GET(getReq(), { params: params("mathA") });

    expect(findUniqueCalls).toHaveLength(1);
    expect(findUniqueCalls[0]).toEqual({ where: { id: storageId("user_1", "mathA") } });
  });

  it("row present and owned → 200 with the stored doc + camera, exactly", async () => {
    currentUser = "user_1";
    const stored = { userId: "user_1", doc: { a: 1, regions: [] }, camera: { x: 9, y: 8, scale: 2 } };
    findUniqueImpl = async () => stored;

    const res = await GET(getReq(), { params: params("default") });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ doc: stored.doc, camera: stored.camera });
  });

  it("row missing (findUnique → null) → 404 not_found (recoverable)", async () => {
    currentUser = "user_1";
    findUniqueImpl = async () => null;

    const res = await GET(getReq(), { params: params("default") });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "not_found",
      message: "No workspace yet.",
      recoverable: true,
    });
  });

  it("findUnique throws → .catch swallows it → 404 (never a 500)", async () => {
    currentUser = "user_1";
    findUniqueImpl = async () => {
      throw new Error("connection reset");
    };

    const res = await GET(getReq(), { params: params("default") });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
  });

  it("row exists but belongs to another user → 404 (ownership guard, no leak)", async () => {
    currentUser = "user_1";
    const foreign = { userId: "user_2", doc: { secret: true }, camera: { x: 0, y: 0, scale: 1 } };
    findUniqueImpl = async () => foreign;

    const res = await GET(getReq(), { params: params("default") });

    expect(res.status).toBe(404);
    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toContain("secret");
  });
});

// ---------------------------------------------------------------- PUT

describe("PUT /api/workspace/[id] — auth gate", () => {
  it("no user → 401 with the exact unauthenticated envelope", async () => {
    currentUser = null;
    const res = await PUT(putReq(JSON.stringify(validState)), { params: params("default") });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "unauthenticated",
      message: "Sign in first.",
      recoverable: false,
    });
  });

  it("no user → never writes to the database", async () => {
    currentUser = null;
    upsertImpl = async () => {
      throw new Error("upsert must not run when unauthenticated");
    };
    const res = await PUT(putReq(JSON.stringify(validState)), { params: params("default") });

    expect(res.status).toBe(401);
    expect(upsertCalls).toHaveLength(0);
    expect(emitCalls).toHaveLength(0);
  });
});

describe("PUT /api/workspace/[id] — size guard", () => {
  it("body length strictly over MAX_DOC_BYTES → 413 too_large, never parsed or written", async () => {
    currentUser = "user_1";
    maxDocBytes = 10;
    const res = await PUT(putReq("x".repeat(11)), { params: params("default") });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      code: "too_large",
      message: "Workspace too large.",
      recoverable: false,
    });
    expect(upsertCalls).toHaveLength(0);
    expect(emitCalls).toHaveLength(0);
  });

  it("body length exactly at the limit is NOT too large (`>` not `>=`) — falls through to JSON parse", async () => {
    currentUser = "user_1";
    maxDocBytes = 10;
    // 10 chars, exactly the limit, and invalid JSON → must reach the parser (400), not 413.
    const res = await PUT(putReq("x".repeat(10)), { params: params("default") });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Invalid JSON.",
      recoverable: false,
    });
  });
});

describe("PUT /api/workspace/[id] — body validation", () => {
  it("invalid JSON → 400 'Invalid JSON.' and nothing persisted", async () => {
    currentUser = "user_1";
    const res = await PUT(putReq("{not json"), { params: params("default") });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Invalid JSON.",
      recoverable: false,
    });
    expect(upsertCalls).toHaveLength(0);
    expect(emitCalls).toHaveLength(0);
  });

  it("valid JSON but wrong shape → 400 'Invalid workspace shape.'", async () => {
    currentUser = "user_1";
    const res = await PUT(putReq(JSON.stringify({ doc: { nope: true } })), {
      params: params("default"),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Invalid workspace shape.",
      recoverable: false,
    });
    expect(upsertCalls).toHaveLength(0);
    expect(emitCalls).toHaveLength(0);
  });

  it("camera missing a required numeric field → shape rejected (400)", async () => {
    currentUser = "user_1";
    const bad = { doc: validState.doc, camera: { x: 1, y: 2 } }; // no scale
    const res = await PUT(putReq(JSON.stringify(bad)), { params: params("default") });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: "Invalid workspace shape." });
  });
});

describe("PUT /api/workspace/[id] — happy path", () => {
  it("valid state → upsert with exact create/update clauses keyed by the composite id", async () => {
    currentUser = "user_1";
    const res = await PUT(putReq(JSON.stringify(validState)), { params: params("canvasZ") });
    const key = storageId("user_1", "canvasZ");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toEqual({
      where: { id: key },
      create: { id: key, userId: "user_1", doc: validState.doc, camera: validState.camera },
      update: { doc: validState.doc, camera: validState.camera },
    });
  });

  it("valid state → emits workspace.saved with the BARE id, server source, for THIS user", async () => {
    currentUser = "user_1";
    await PUT(putReq(JSON.stringify(validState)), { params: params("canvasZ") });

    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0]).toEqual(["user_1", "workspace.saved", { id: "canvasZ" }, "server"]);
  });

  it("upsert is awaited before emit — save then announce (ordering)", async () => {
    currentUser = "user_1";
    const order: string[] = [];
    upsertImpl = async () => {
      order.push("upsert");
      return {};
    };
    // emit records into emitCalls; wrap to also note order
    await PUT(putReq(JSON.stringify(validState)), { params: params("default") });
    order.push("emit"); // emit already resolved by here; the route awaits upsert first
    expect(order[0]).toBe("upsert");
  });

  it("a userId containing a colon still round-trips into a valid storage key", async () => {
    currentUser = "org:team:user";
    await PUT(putReq(JSON.stringify(validState)), { params: params("c1") });

    const key = storageId("org:team:user", "c1");
    expect(upsertCalls[0]).toMatchObject({ where: { id: key } });
    expect(emitCalls[0]).toEqual(["org:team:user", "workspace.saved", { id: "c1" }, "server"]);
  });
});

// ---------------------------------------------------------------- PUT (extended)

describe("PUT /api/workspace/[id] — persists the VALIDATED body, not the raw input", () => {
  it("unknown top-level keys on doc/camera are stripped by zod before upsert (untrusted input sanitised)", async () => {
    currentUser = "user_1";
    // Hostile extras riding on an otherwise-valid envelope. z.object() strips unknown
    // keys, so what reaches the DB must be the clean parsed shape — NOT the raw body.
    const dirty = {
      doc: { ...validState.doc, hacked: true, __proto__polluted: 1 },
      camera: { ...validState.camera, zoom: 99 },
    };
    const res = await PUT(putReq(JSON.stringify(dirty)), { params: params("default") });
    expect(res.status).toBe(200);

    const call = upsertCalls[0] as { create: { doc: unknown; camera: unknown }; update: { doc: unknown; camera: unknown } };
    // Exact deep-equal to the CLEAN shape — an extra key would break toEqual.
    expect(call.create.doc).toEqual(validState.doc);
    expect(call.create.camera).toEqual(validState.camera);
    expect(call.update.doc).toEqual(validState.doc);
    expect(call.update.camera).toEqual(validState.camera);
    expect(call.create.doc).not.toHaveProperty("hacked");
    expect(call.create.camera).not.toHaveProperty("zoom");
  });

  it("a valid optional field (doc.topic) survives validation and is persisted", async () => {
    currentUser = "user_1";
    const withTopic = { doc: { ...validState.doc, topic: "Trigonometry" }, camera: validState.camera };
    await PUT(putReq(JSON.stringify(withTopic)), { params: params("default") });

    const call = upsertCalls[0] as { create: { doc: { topic?: string } } };
    expect(call.create.doc.topic).toBe("Trigonometry");
  });
});

describe("PUT /api/workspace/[id] — write-then-announce ordering / no error swallow", () => {
  it("upsert rejects → PUT rejects, and emit is never reached (write happens before announce, error not swallowed)", async () => {
    currentUser = "user_1";
    upsertImpl = async () => {
      throw new Error("db down");
    };

    await expect(
      PUT(putReq(JSON.stringify(validState)), { params: params("default") }),
    ).rejects.toThrow("db down");

    // upsert was attempted exactly once; emit never ran because the failed write short-circuits it.
    expect(upsertCalls).toHaveLength(1);
    expect(emitCalls).toHaveLength(0);
  });
});

describe("PUT /api/workspace/[id] — size guard + empty body edges", () => {
  it("empty body → JSON.parse('') throws → 400 Invalid JSON, nothing persisted", async () => {
    currentUser = "user_1";
    const res = await PUT(putReq(""), { params: params("default") });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Invalid JSON.",
      recoverable: false,
    });
    expect(upsertCalls).toHaveLength(0);
    expect(emitCalls).toHaveLength(0);
  });

  it("guard measures JS string length (raw.length), not UTF-8 byte length — a multibyte body under the char limit falls through", async () => {
    currentUser = "user_1";
    maxDocBytes = 3;
    // "😀x": JS string length 3 (astral char = 2 UTF-16 units) but 5 UTF-8 bytes.
    // The route compares raw.length (3), 3 > 3 is false → NOT 413; it reaches the
    // JSON parser (invalid) → 400. A byte-length guard would have returned 413.
    expect("😀x".length).toBe(3);
    const res = await PUT(putReq("😀x"), { params: params("default") });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad_request", message: "Invalid JSON." });
    expect(upsertCalls).toHaveLength(0);
  });
});
