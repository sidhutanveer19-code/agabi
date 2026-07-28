import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_CAMERA } from "@/features/workspace/types/defaults";
import { SCHEMA_VERSION } from "@/features/workspace/types";

/**
 * setCanvasMeta — stamps title+subject onto a Workspace row via a single upsert.
 * The ONLY I/O boundary (prisma) is stubbed at the edge. Everything else runs for
 * REAL: the composite-key builder `storageId` (incl. a colon-containing userId),
 * the shared `emptyDoc` seed (monotonic counter + topic passthrough), and the
 * `DEFAULT_CAMERA` reference. Every upsert arg (where / create / update) is asserted
 * to its EXACT value — no "was called" without naming the payload — plus the void
 * return and the error-propagation (no try/catch) path.
 */

// Mutable per-test behaviour, hoisted above the vi.mock factory.
const h = vi.hoisted(() => ({
  workspaceUpsert: (async () => ({})) as (a: unknown) => Promise<unknown>,
}));

vi.mock("@/server/db", () => ({
  prisma: {
    workspace: { upsert: vi.fn((a: unknown) => h.workspaceUpsert(a)) },
  },
}));

const { setCanvasMeta } = await import("@/server/conversation/canvasRepo");
const { prisma } = await import("@/server/db");
const upsert = prisma.workspace.upsert as unknown as ReturnType<typeof vi.fn>;

type UpsertArg = {
  where: { id: string };
  create: {
    id: string;
    userId: string;
    doc: {
      id: string;
      schemaVersion: number;
      topic?: string;
      regions: unknown[];
      createdAt: number;
      updatedAt: number;
    };
    camera: unknown;
    title: string;
    subject: string;
  };
  update: { title: string; subject: string };
};

/** The exact arg passed to prisma.workspace.upsert on call `i` (default: last). */
function upsertArg(i = upsert.mock.calls.length - 1): UpsertArg {
  return upsert.mock.calls[i][0] as UpsertArg;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.workspaceUpsert = async () => ({});
});

describe("setCanvasMeta — happy path upsert shape", () => {
  it("issues exactly one upsert with the EXACT where/create/update payload", async () => {
    const ret = await setCanvasMeta("u1", "c1", { title: "Quadratics", subject: "math" });

    expect(ret).toBeUndefined(); // Promise<void>
    expect(upsert).toHaveBeenCalledTimes(1);

    const arg = upsertArg();
    // Top-level keys are exactly the three upsert clauses — nothing extra leaks.
    expect(Object.keys(arg).sort()).toEqual(["create", "update", "where"]);

    // where: composite storage id "${userId}:${canvasId}"
    expect(arg.where).toEqual({ id: "u1:c1" });

    // create: seed row. camera is the SHARED DEFAULT_CAMERA reference (===), value pinned.
    expect(arg.create.id).toBe("u1:c1");
    expect(arg.create.userId).toBe("u1");
    expect(arg.create.title).toBe("Quadratics");
    expect(arg.create.subject).toBe("math");
    expect(arg.create.camera).toBe(DEFAULT_CAMERA);
    expect(arg.create.camera).toEqual({ x: 0, y: 0, scale: 1 });

    // create.doc is a fresh emptyDoc(title): deterministic fields pinned exactly,
    // and the counter-stamped fields are internally consistent (id suffix === timestamps).
    const doc = arg.create.doc;
    const seq = Number(doc.id.slice("ws_".length));
    expect(doc.id).toMatch(/^ws_\d+$/);
    expect(doc).toEqual({
      id: `ws_${seq}`,
      schemaVersion: SCHEMA_VERSION, // real value = 3
      topic: "Quadratics",
      regions: [],
      createdAt: seq,
      updatedAt: seq,
    });

    // update: ONLY title + subject — never re-seeds doc/camera/id/userId.
    expect(Object.keys(arg.update).sort()).toEqual(["subject", "title"]);
    expect(arg.update).toEqual({ title: "Quadratics", subject: "math" });
  });

  it("emptyDoc is genuinely invoked per call: the doc counter strictly increments by 1", async () => {
    await setCanvasMeta("u1", "cA", { title: "First", subject: "s" });
    const first = Number(upsertArg().create.doc.id.slice("ws_".length));

    await setCanvasMeta("u1", "cB", { title: "Second", subject: "s" });
    const second = Number(upsertArg().create.doc.id.slice("ws_".length));

    expect(second).toBe(first + 1);
    // topic flows straight from meta.title into the seeded doc, per call.
    expect(upsert.mock.calls[0][0].create.doc.topic).toBe("First");
    expect(upsert.mock.calls[1][0].create.doc.topic).toBe("Second");
  });
});

describe("setCanvasMeta — storageId composition edge", () => {
  it("a colon-containing userId still round-trips into a single '${userId}:${canvasId}' key", async () => {
    await setCanvasMeta("org:42", "c9", { title: "T", subject: "S" });
    const arg = upsertArg();
    expect(arg.where.id).toBe("org:42:c9");
    expect(arg.create.id).toBe("org:42:c9");
    expect(arg.create.userId).toBe("org:42"); // userId column kept intact, not split
  });
});

describe("setCanvasMeta — empty-string edge inputs", () => {
  it("empty title/subject are forwarded verbatim; doc.topic is '' (not undefined)", async () => {
    await setCanvasMeta("u1", "c1", { title: "", subject: "" });
    const arg = upsertArg();

    expect(arg.create.title).toBe("");
    expect(arg.create.subject).toBe("");
    expect(arg.create.doc.topic).toBe(""); // emptyDoc("") keeps the empty string
    expect(arg.update).toEqual({ title: "", subject: "" });
  });
});

describe("setCanvasMeta — error propagation (no try/catch)", () => {
  it("a rejecting upsert propagates the SAME error to the caller", async () => {
    const boom = new Error("db upsert down");
    h.workspaceUpsert = async () => {
      throw boom;
    };
    await expect(
      setCanvasMeta("u1", "c1", { title: "X", subject: "Y" }),
    ).rejects.toBe(boom);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
