import { describe, it, expect, vi, beforeEach } from "vitest";
import { storageId } from "@/server/conversation/ids";

/**
 * Unit coverage for GET /api/workspace — the sidebar "Recent" list.
 *
 * The route has four behaviours worth pinning, each with both branches exercised:
 *   1. no user            → 401 with the exact unauthenticated envelope
 *   2. user + rows        → 200, prefix-stripped bare ids, numeric updatedAt, order preserved
 *   3. user + empty rows  → 200 with [] (map over nothing)
 *   4. DB throws          → `.catch(() => [])` swallows it → 200 with []
 *
 * We stub ONLY the two I/O seams (auth + prisma) per §H1.7; the id math (`bareId`)
 * is real. We also capture the exact prisma query so a mutation to the where /
 * orderBy / select clause goes red, and capture the arg handed to getUserId so a
 * mutation dropping `req` goes red.
 */

let currentUser: string | null = null;
let findManyImpl: (args: unknown) => Promise<unknown>;
const findManyCalls: unknown[] = [];
const getUserIdArgs: unknown[] = [];

vi.mock("@/server/auth", () => ({
  getUserId: async (req: unknown) => {
    getUserIdArgs.push(req);
    return currentUser;
  },
}));

vi.mock("@/server/db", () => ({
  prisma: {
    workspace: {
      findMany: (args: unknown) => {
        findManyCalls.push(args);
        return findManyImpl(args);
      },
    },
  },
}));

const { GET } = await import("@/app/api/workspace/route");

const req = () => new Request("http://localhost/api/workspace");

beforeEach(() => {
  currentUser = null;
  findManyCalls.length = 0;
  getUserIdArgs.length = 0;
  // Default: no rows. Individual tests override.
  findManyImpl = async () => [];
});

describe("GET /api/workspace — auth gate", () => {
  it("no user → 401 with the exact unauthenticated envelope and JSON content-type", async () => {
    currentUser = null;
    const res = await GET(req());

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
    findManyImpl = async () => {
      throw new Error("prisma must not be called when unauthenticated");
    };
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(findManyCalls).toHaveLength(0);
  });

  it("passes the incoming Request straight to getUserId", async () => {
    const r = req();
    await GET(r);
    expect(getUserIdArgs).toHaveLength(1);
    expect(getUserIdArgs[0]).toBe(r);
  });
});

describe("GET /api/workspace — happy path", () => {
  it("maps rows to bare summaries: prefix stripped, updatedAt as epoch ms, order preserved", async () => {
    currentUser = "user_1";
    findManyImpl = async () => [
      { id: storageId("user_1", "canvasA"), title: "Alpha", subject: "math", updatedAt: new Date(1_700_000_000_000) },
      { id: storageId("user_1", "canvasB"), title: "Beta", subject: "science", updatedAt: new Date(1_600_000_000_000) },
    ];

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual([
      { id: "canvasA", title: "Alpha", subject: "math", updatedAt: 1_700_000_000_000 },
      { id: "canvasB", title: "Beta", subject: "science", updatedAt: 1_600_000_000_000 },
    ]);
  });

  it("never leaks the composite `${userId}:${id}` key — bare id only, even for a colon-containing userId", async () => {
    currentUser = "org:team:user";
    findManyImpl = async () => [
      { id: storageId("org:team:user", "abc123"), title: "T", subject: null, updatedAt: new Date(1_000) },
    ];

    const res = await GET(req());
    const body = (await res.json()) as Array<{ id: string }>;

    expect(body[0].id).toBe("abc123");
    // hard guard: no part of the storage prefix survives into the payload
    expect(JSON.stringify(body)).not.toContain("org:team:user");
  });

  it("preserves null title/subject (both are nullable columns) untouched", async () => {
    currentUser = "user_1";
    findManyImpl = async () => [
      { id: storageId("user_1", "c9"), title: null, subject: null, updatedAt: new Date(42) },
    ];

    const res = await GET(req());
    expect(await res.json()).toEqual([{ id: "c9", title: null, subject: null, updatedAt: 42 }]);
  });

  it("updatedAt is emitted as a number, never a Date/string", async () => {
    currentUser = "user_1";
    findManyImpl = async () => [
      { id: storageId("user_1", "c1"), title: "x", subject: "y", updatedAt: new Date(1_234_567) },
    ];

    const res = await GET(req());
    const body = (await res.json()) as Array<{ updatedAt: unknown }>;
    expect(typeof body[0].updatedAt).toBe("number");
    expect(body[0].updatedAt).toBe(1_234_567);
  });

  it("queries only THIS user's rows, newest-first, selecting exactly the summary columns", async () => {
    currentUser = "user_42";
    findManyImpl = async () => [];

    await GET(req());

    expect(findManyCalls).toHaveLength(1);
    expect(findManyCalls[0]).toEqual({
      where: { userId: "user_42" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, subject: true, updatedAt: true },
    });
  });
});

describe("GET /api/workspace — empty & failure", () => {
  it("user with zero canvases → 200 with []", async () => {
    currentUser = "user_1";
    findManyImpl = async () => [];

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("DB rejection is swallowed by .catch → 200 with [] (fails soft, never 500)", async () => {
    currentUser = "user_1";
    findManyImpl = async () => {
      throw new Error("connection reset");
    };

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
