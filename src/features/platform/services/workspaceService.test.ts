import { describe, it, expect, vi, beforeEach } from "vitest";
import { ENDPOINTS } from "@contract";
import type { Camera, WorkspaceDoc } from "@/features/workspace/types";

/**
 * workspaceService — the backend `WorkspacePersistence` impl (cache + dedupe + PUT).
 *
 * The ONLY I/O edge (`apiClient` → fetch) is stubbed; everything asserted here is
 * the module's OWN logic, exercised through the real `@contract` schema + endpoints
 * (NOT mocked — parsing/validating an untrusted response is logic, §H1.7):
 *   - fetchState: safeParse SUCCESS populates the slot; safeParse FAILURE and a
 *     thrown getJson both leave the slot null (caller recovers).
 *   - ensureFetched: concurrent calls share ONE inflight promise (getJson once);
 *     after it settles inflight is cleared, so a later load re-fetches.
 *   - put: `!s.doc` early-return (saveCamera before any doc → NO PUT); the
 *     `s.camera ?? {0,0,1}` fallback (null camera) vs a present camera forwarded as-is.
 *   - slot: cache MISS creates a slot, cache HIT reuses it (save overwrites in place).
 * Every case names the exact returned value / request body and asserts THAT.
 */

// Mutable per-test behaviour, hoisted above the vi.mock factory.
const h = vi.hoisted(() => ({
  getJson: (async () => ({})) as (path: string) => Promise<unknown>,
  putJson: (async () => ({})) as (path: string, body: unknown) => Promise<unknown>,
}));

vi.mock("@/features/platform/client/apiClient", () => ({
  apiClient: {
    getJson: vi.fn((path: string) => h.getJson(path)),
    putJson: vi.fn((path: string, body: unknown) => h.putJson(path, body)),
  },
}));

const { workspaceService } = await import("@/features/platform/services/workspaceService");
const { apiClient } = await import("@/features/platform/client/apiClient");
const getJson = apiClient.getJson as unknown as ReturnType<typeof vi.fn>;
const putJson = apiClient.putJson as unknown as ReturnType<typeof vi.fn>;

const DOC: WorkspaceDoc = {
  id: "doc-abc",
  schemaVersion: 3,
  topic: "Quadratic equations",
  regions: [
    {
      id: "r1",
      title: "Intro",
      position: { x: 10, y: 20 },
      size: { w: 300, h: 200 },
      blocks: [{ id: "b1", type: "text", position: { x: 0, y: 0 }, size: { w: 100, h: 40 }, z: 0, data: { md: "hi" } }],
      createdAt: 1700,
    },
  ],
  createdAt: 1000,
  updatedAt: 2000,
};
const CAM: Camera = { x: 42, y: -7, scale: 1.5 };
const validState = () => ({ doc: structuredClone(DOC), camera: { ...CAM } });

// Module-level cache/inflight persist across tests → each test uses a UNIQUE id.
let n = 0;
const freshId = () => `ws-${n++}`;

beforeEach(() => {
  vi.clearAllMocks();
  h.getJson = async () => ({});
  h.putJson = async () => ({});
});

describe("load — fetchState parse SUCCESS populates the slot", () => {
  it("valid state → loadDoc returns the exact doc, loadCamera the exact camera; GET hits the id path", async () => {
    const id = freshId();
    h.getJson = async () => validState();

    expect(await workspaceService.loadDoc(id)).toEqual(DOC);
    expect(await workspaceService.loadCamera(id)).toEqual(CAM);
    expect(getJson).toHaveBeenCalledWith(ENDPOINTS.workspace(id).get.path);
  });

  it("GET path is percent-encoded via the contract for an id with reserved chars", async () => {
    h.getJson = async () => validState();
    await workspaceService.loadDoc("a/b c");
    expect(getJson).toHaveBeenCalledWith("/api/workspace/a%2Fb%20c");
  });
});

describe("load — fetchState leaves slot null (doc/camera stay null)", () => {
  it("safeParse FAILURE (garbage response) → loadDoc null, loadCamera null, no throw", async () => {
    const id = freshId();
    h.getJson = async () => ({ doc: { not: "a doc" }, camera: "nope" });

    expect(await workspaceService.loadDoc(id)).toBeNull();
    expect(await workspaceService.loadCamera(id)).toBeNull();
    expect(getJson).toHaveBeenCalled();
  });

  it("empty object response → schema misses required doc/camera → null", async () => {
    const id = freshId();
    h.getJson = async () => ({});
    expect(await workspaceService.loadDoc(id)).toBeNull();
  });

  it("getJson THROWS (404 / backend down) → swallowed → loadDoc null", async () => {
    const id = freshId();
    h.getJson = async () => {
      throw new Error("404 not found");
    };
    expect(await workspaceService.loadDoc(id)).toBeNull();
  });
});

describe("ensureFetched — dedupe then re-fetch", () => {
  it("concurrent loadDoc + loadCamera on one id share ONE inflight fetch (getJson called once)", async () => {
    const id = freshId();
    h.getJson = async () => validState();

    const [doc, cam] = await Promise.all([workspaceService.loadDoc(id), workspaceService.loadCamera(id)]);

    expect(getJson).toHaveBeenCalledTimes(1);
    expect(doc).toEqual(DOC);
    expect(cam).toEqual(CAM);
  });

  it("inflight is cleared on settle → two SEQUENTIAL loads re-fetch (getJson called twice)", async () => {
    const id = freshId();
    h.getJson = async () => validState();

    await workspaceService.loadDoc(id);
    await workspaceService.loadDoc(id);

    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("recovers after a failed fetch: first (throw) → null, second (valid) → the doc", async () => {
    const id = freshId();
    h.getJson = async () => {
      throw new Error("down");
    };
    expect(await workspaceService.loadDoc(id)).toBeNull();

    h.getJson = async () => validState();
    expect(await workspaceService.loadDoc(id)).toEqual(DOC);
    expect(getJson).toHaveBeenCalledTimes(2);
  });
});

describe("put — early return + camera fallback", () => {
  it("saveCamera BEFORE any doc → put hits `!s.doc` early-return → NO PUT sent", async () => {
    const id = freshId();
    await workspaceService.saveCamera(id, CAM);
    expect(putJson).not.toHaveBeenCalled();
  });

  it("saveDoc with a NULL slot camera → PUTs { doc, camera: {0,0,1} } fallback to the id path", async () => {
    const id = freshId();
    await workspaceService.saveDoc(id, DOC);

    expect(putJson).toHaveBeenCalledTimes(1);
    expect(putJson).toHaveBeenCalledWith(ENDPOINTS.workspace(id).put.path, {
      doc: DOC,
      camera: { x: 0, y: 0, scale: 1 },
    });
  });

  it("saveCamera(no doc) then saveDoc → the stored camera is forwarded as-is (NOT the fallback)", async () => {
    const id = freshId();
    await workspaceService.saveCamera(id, CAM); // stored, early-return, no PUT
    expect(putJson).not.toHaveBeenCalled();

    await workspaceService.saveDoc(id, DOC); // now doc present → PUT uses the stored camera
    expect(putJson).toHaveBeenCalledTimes(1);
    expect(putJson).toHaveBeenCalledWith(ENDPOINTS.workspace(id).put.path, { doc: DOC, camera: CAM });
  });

  it("saveCamera AFTER a doc exists → PUT carries the new camera value", async () => {
    const id = freshId();
    await workspaceService.saveDoc(id, DOC); // PUT #1 with fallback camera
    const newCam: Camera = { x: 1, y: 2, scale: 3 };
    await workspaceService.saveCamera(id, newCam); // PUT #2 with the new camera

    expect(putJson).toHaveBeenCalledTimes(2);
    expect(putJson).toHaveBeenLastCalledWith(ENDPOINTS.workspace(id).put.path, { doc: DOC, camera: newCam });
  });
});

describe("slot — cache HIT reuses the same slot (save overwrites in place)", () => {
  it("two saveDoc calls on one id → second PUT carries the SECOND doc (slot reused, not duplicated)", async () => {
    const id = freshId();
    const docB: WorkspaceDoc = { ...DOC, id: "doc-B", topic: "Circles", updatedAt: 9999 };

    await workspaceService.saveDoc(id, DOC);
    await workspaceService.saveDoc(id, docB);

    expect(putJson).toHaveBeenCalledTimes(2);
    expect(putJson.mock.calls[1][1]).toEqual({ doc: docB, camera: { x: 0, y: 0, scale: 1 } });
    expect(getJson).not.toHaveBeenCalled(); // saving never triggers a fetch
  });

  it("a rejected PUT propagates out of saveDoc (failure is not swallowed)", async () => {
    const id = freshId();
    h.putJson = async () => {
      throw new Error("PUT 500");
    };
    await expect(workspaceService.saveDoc(id, DOC)).rejects.toThrow("PUT 500");
  });
});
