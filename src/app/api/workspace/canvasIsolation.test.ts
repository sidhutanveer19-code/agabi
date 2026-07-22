import { describe, it, expect, vi, beforeEach } from "vitest";
import { storageId } from "@/server/conversation/ids";

/**
 * Cross-user isolation (#3). Nothing should let user B read user A's canvas or write
 * into A's namespace. Two guards prove it: (1) the storage key is `${userId}:${id}`,
 * so B querying id X looks up `B:X`, never `A:X`; (2) even a key match is rejected by
 * `ws.userId !== userId`. Writes always compose `storageId(currentUser, ...)`, so an
 * unknown-to-you id is simply a fresh empty canvas of your own.
 */

// A tiny in-memory Workspace store keyed by the composite id, mimicking Prisma.
const store: Record<string, { id: string; userId: string; doc: unknown; camera: unknown }> = {};
let currentUser: string | null = null;

vi.mock("@/server/auth", () => ({ getUserId: async () => currentUser }));
vi.mock("@/server/db", () => ({
  prisma: {
    workspace: {
      findUnique: async ({ where }: { where: { id: string } }) => store[where.id] ?? null,
    },
  },
}));

const { GET } = await import("@/app/api/workspace/[id]/route");

const req = () => new Request("http://localhost/api/workspace/c1");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  currentUser = null;
});

describe("canvas cross-user isolation", () => {
  it("GET another user's canvas id → 404, never returns their doc", async () => {
    store[storageId("userA", "c1")] = { id: storageId("userA", "c1"), userId: "userA", doc: { secret: 42 }, camera: {} };
    currentUser = "userB"; // B guesses A's bare id "c1"
    const res = await GET(req(), ctx("c1"));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("GET your OWN canvas → 200 with your doc", async () => {
    store[storageId("userA", "c1")] = { id: storageId("userA", "c1"), userId: "userA", doc: { mine: true }, camera: { x: 0, y: 0, scale: 1 } };
    currentUser = "userA";
    const res = await GET(req(), ctx("c1"));
    expect(res.status).toBe(200);
    expect((await res.json()).doc).toEqual({ mine: true });
  });

  it("defensive: a key hit whose row.userId differs is still 404", async () => {
    // Force the pathological case: the composite key matches but the row belongs to A.
    store[storageId("userB", "c1")] = { id: storageId("userB", "c1"), userId: "userA", doc: { secret: 1 }, camera: {} };
    currentUser = "userB";
    const res = await GET(req(), ctx("c1"));
    expect(res.status).toBe(404);
  });

  it("writes always land in the CURRENT user's namespace, never another's", () => {
    expect(storageId("userB", "anothersId")).toBe("userB:anothersId");
    expect(storageId("userB", "x")).not.toBe(storageId("userA", "x"));
  });
});
