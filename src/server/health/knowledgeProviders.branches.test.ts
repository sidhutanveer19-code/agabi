import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HealthProvider, HealthReport } from "@/server/health/types";

/**
 * Adversarial branch coverage for §28 knowledge health providers.
 *
 * We mock ONLY the two I/O boundaries the file reaches through — the Postgres store
 * (`createPostgresStore`) and the Prisma client (`prisma.$queryRaw`). The classification
 * logic (isMissingTable / classify), the acyclicity checks, the trust-ladder filter, and
 * the UP/UNSAFE/NOT_INSTALLED/DOWN decisions are the REAL code under test — never mocked.
 */

const h = vi.hoisted(() => ({
  listConcepts: vi.fn(),
  dependencyEdges: vi.fn(),
  compositionEdges: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  prisma: { $queryRaw: h.queryRaw },
}));

vi.mock("@/server/knowledge/store/postgres", () => ({
  createPostgresStore: () => ({
    listConcepts: h.listConcepts,
    dependencyEdges: h.dependencyEdges,
    compositionEdges: h.compositionEdges,
  }),
}));

// Importing the module runs its register() side effects.
import "@/server/health/knowledgeProviders";
import { providers } from "@/server/health/registry";

function provider(name: string): HealthProvider {
  const p = providers().find((x) => x.name === name);
  if (!p) throw new Error(`provider ${name} not registered`);
  return p;
}
const check = (name: string): Promise<HealthReport> => provider(name).check();

beforeEach(() => {
  vi.clearAllMocks();
  // Safe defaults: acyclic graphs, zero counts. Individual tests override.
  h.listConcepts.mockResolvedValue([]);
  h.dependencyEdges.mockResolvedValue([]);
  h.compositionEdges.mockResolvedValue([]);
  h.queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
});

describe("registration + metadata (§28)", () => {
  it("registers exactly the five knowledge providers with the right kinds/deps", () => {
    expect(provider("knowledge-store").dependencies).toEqual(["database"]);
    expect(provider("knowledge-integrity").dependencies).toEqual(["knowledge-store"]);
    expect(provider("trust-pipeline").dependencies).toEqual(["knowledge-store"]);
    expect(provider("ingestion").kind).toBe("engine");
    expect(provider("observation-store").kind).toBe("engine");
  });
});

describe("knowledge-store", () => {
  it("UP when the store is reachable, with a non-negative latency", async () => {
    h.listConcepts.mockResolvedValue([{ id: "c1" }]);
    const r = await check("knowledge-store");
    expect(r.status).toBe("UP");
    expect(r.reason).toBe("knowledge store reachable");
    expect(typeof r.latencyMs).toBe("number");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    // It probes the PUBLIC scope, not something else.
    expect(h.listConcepts).toHaveBeenCalledWith("PUBLIC");
  });

  it("NOT_INSTALLED on Prisma P2021 (undefined table) — exact report", async () => {
    h.listConcepts.mockRejectedValue({ code: "P2021" });
    const r = await check("knowledge-store");
    expect(r).toEqual({
      status: "NOT_INSTALLED",
      reason: "knowledge tables not pushed yet",
      evidence: { activatesIn: "after the M0 knowledge db push (A-2)" },
    });
  });

  it("NOT_INSTALLED on Postgres 42P01 carried in meta.code", async () => {
    h.listConcepts.mockRejectedValue({ meta: { code: "42P01" } });
    expect((await check("knowledge-store")).status).toBe("NOT_INSTALLED");
  });

  it('NOT_INSTALLED when the message matches "relation ... does not exist"', async () => {
    h.listConcepts.mockRejectedValue(new Error('relation "Statement" does not exist'));
    expect((await check("knowledge-store")).status).toBe("NOT_INSTALLED");
  });

  it("DOWN on a real, non-missing-table failure — reason carries the message", async () => {
    h.listConcepts.mockRejectedValue(new Error("connection refused"));
    const r = await check("knowledge-store");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("knowledge probe failed: connection refused");
  });

  it("DOWN with String(err) when a non-Error value is thrown", async () => {
    h.listConcepts.mockRejectedValue("boom");
    const r = await check("knowledge-store");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("knowledge probe failed: boom");
  });

  it("DOWN with 'null' when null is thrown (no crash on nullish error)", async () => {
    h.listConcepts.mockRejectedValue(null);
    const r = await check("knowledge-store");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("knowledge probe failed: null");
  });
});

describe("knowledge-integrity", () => {
  it("UP with exact evidence when acyclic and no missing provenance", async () => {
    const r = await check("knowledge-integrity");
    expect(r.status).toBe("UP");
    expect(r.reason).toBe("0 cycles, 0 missing provenance");
    expect(r.evidence).toEqual({ cyclesOk: true, missingProvenance: 0 });
  });

  it("UNSAFE when the dependency graph has a cycle (missingProvenance still 0)", async () => {
    h.dependencyEdges.mockResolvedValue([
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "a" },
    ]);
    const r = await check("knowledge-integrity");
    expect(r.status).toBe("UNSAFE");
    expect(r.reason).toBe(
      "integrity breach — cycles:true missingProvenance:0; teaching degrades to ungrounded",
    );
    expect(r.evidence).toEqual({ cyclesOk: false, missingProvenance: 0 });
  });

  it("UNSAFE when a composition cycle exists even though dependency is clean", async () => {
    h.compositionEdges.mockResolvedValue([
      { partId: "x", wholeId: "y" },
      { partId: "y", wholeId: "x" },
    ]);
    // composition edges expose from/to as partId/wholeId — the composition graph maps them.
    const r = await check("knowledge-integrity");
    expect(r.status).toBe("UNSAFE");
    expect(r.evidence).toMatchObject({ cyclesOk: false });
  });

  it("UNSAFE when provenance is missing above MACHINE_PROPOSED (bigint coerced)", async () => {
    h.queryRaw.mockResolvedValue([{ count: BigInt(5) }]);
    const r = await check("knowledge-integrity");
    expect(r.status).toBe("UNSAFE");
    expect(r.reason).toBe(
      "integrity breach — cycles:false missingProvenance:5; teaching degrades to ungrounded",
    );
    expect(r.evidence).toEqual({ cyclesOk: true, missingProvenance: 5 });
  });

  it("treats an empty count row as 0 missing provenance (nullish fallback) → UP", async () => {
    h.queryRaw.mockResolvedValue([]); // missingProvenance[0]?.count ?? 0
    const r = await check("knowledge-integrity");
    expect(r.status).toBe("UP");
    expect(r.evidence).toEqual({ cyclesOk: true, missingProvenance: 0 });
  });

  it("NOT_INSTALLED when the store call reports a missing table", async () => {
    h.dependencyEdges.mockRejectedValue({ code: "P2021" });
    expect((await check("knowledge-integrity")).status).toBe("NOT_INSTALLED");
  });

  it("DOWN when the provenance query throws a generic error", async () => {
    h.queryRaw.mockRejectedValue(new Error("deadlock detected"));
    const r = await check("knowledge-integrity");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("knowledge probe failed: deadlock detected");
  });
});

describe("trust-pipeline", () => {
  it("UP when nothing above AUTO_VALIDATED is unbacked", async () => {
    const r = await check("trust-pipeline");
    expect(r.status).toBe("UP");
    expect(r.reason).toBe("every promotion above the floor is human-backed");
    expect(r.evidence).toEqual({ unbacked: 0 });
  });

  it("filters to EXACTLY the ladder rungs above AUTO_VALIDATED", async () => {
    await check("trust-pipeline");
    // second tagged-template arg is the aboveFloor IN-list
    const aboveFloor = h.queryRaw.mock.calls[0]![1];
    expect(aboveFloor).toEqual([
      "COMMUNITY_REVIEWED",
      "EXPERT_REVIEWED",
      "OFFICIAL_SOURCE_VERIFIED",
      "AGABI_CANONICAL",
    ]);
  });

  it("UNSAFE when promotions above the floor lack a human ReviewEvent", async () => {
    h.queryRaw.mockResolvedValue([{ count: BigInt(3) }]);
    const r = await check("trust-pipeline");
    expect(r.status).toBe("UNSAFE");
    expect(r.reason).toBe("3 statements above AUTO_VALIDATED with no human ReviewEvent");
    expect(r.evidence).toEqual({ unbacked: 3 });
  });

  it("treats an empty result row as 0 unbacked → UP (nullish fallback)", async () => {
    h.queryRaw.mockResolvedValue([]);
    const r = await check("trust-pipeline");
    expect(r.status).toBe("UP");
    expect(r.evidence).toEqual({ unbacked: 0 });
  });

  it("NOT_INSTALLED when the aggregate hits a missing table", async () => {
    h.queryRaw.mockRejectedValue({ meta: { code: "42P01" } });
    expect((await check("trust-pipeline")).status).toBe("NOT_INSTALLED");
  });

  it("DOWN on a generic probe failure", async () => {
    h.queryRaw.mockRejectedValue(new Error("statement timeout"));
    const r = await check("trust-pipeline");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("knowledge probe failed: statement timeout");
  });
});

describe("DB-free engines never fake-green", () => {
  it("ingestion is NOT_INSTALLED with an honest reason and no DB access", async () => {
    const r = await check("ingestion");
    expect(r).toEqual({
      status: "NOT_INSTALLED",
      reason: "ingestion runs synchronously — no backlog queue in Phase 2",
      evidence: { activatesIn: "when a background ingestion queue is added" },
    });
    expect(h.queryRaw).not.toHaveBeenCalled();
    expect(h.listConcepts).not.toHaveBeenCalled();
  });

  it("observation-store is NOT_INSTALLED with its own activation note", async () => {
    const r = await check("observation-store");
    expect(r.status).toBe("NOT_INSTALLED");
    expect(r.reason).toBe(
      "observation store is a separate DB — needs its own push + generated client (M8)",
    );
    expect(r.evidence).toEqual({ activatesIn: "after the M8 observation db push" });
  });
});
