import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Static-mutant killers for src/server/health/providers.ts.
 *
 * Companion to providers.mut.test.ts. Everything this file pins is decided at MODULE
 * LOAD time — the `dependencies: []` array on each statically-registered provider, and
 * the whole `ENGINES` literal table (reason / activatesIn / capabilities) that each
 * engine's check() closes over. A test that imports the module ONCE at file top evaluates
 * those literals a single time, before Stryker's per-mutant switch flips, so the mutated
 * value is never observed and the mutant survives.
 *
 * The only way to kill an import-time ("static") mutant under Stryker + Vitest is to make
 * the module body re-run WHILE the active mutant is set: vi.resetModules() drops the cache
 * and a dynamic re-import re-executes the registrations and the ENGINES table, at which
 * point the mutated literal flows into the fresh registry and the assertions below catch it.
 *
 * Only the narrowest I/O edges are faked (Prisma, @/env, evidence health, outbox); every
 * assertion drives the REAL registered provider from a freshly re-evaluated module graph.
 */

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  eventCount: vi.fn(),
  outboxStats: vi.fn(),
  evidenceHealth: { droppedT1: 0, lastDropAt: null as number | null, outboxUnavailable: false },
  env: { AUTH_SECRET: "0123456789abcdef", AUTH_MODE: "dev" as "dev" | "clerk" },
}));

vi.mock("@/server/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
    event: { count: (...args: unknown[]) => mocks.eventCount(...args) },
  },
}));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/server/events", () => ({ getEvidenceHealth: () => mocks.evidenceHealth }));
vi.mock("@/server/evidence/outbox", () => ({ outboxStats: (...args: unknown[]) => mocks.outboxStats(...args) }));

import type { HealthProvider, HealthReport } from "@/server/health/types";

/**
 * Re-evaluate the providers module (and its registry) INSIDE the test body so import-time
 * literals take the currently-active mutant's value, then hand back the fresh registry list.
 */
async function freshProviders(): Promise<HealthProvider[]> {
  vi.resetModules();
  await import("@/server/health/providers"); // side-effect: register() into a fresh registry
  const reg = await import("@/server/health/registry");
  return reg.providers();
}
async function freshProvider(name: string): Promise<HealthProvider> {
  const p = (await freshProviders()).find((x) => x.name === name);
  if (!p) throw new Error(`provider "${name}" not registered`);
  return p;
}
async function freshRun(name: string): Promise<HealthReport> {
  return (await freshProvider(name)).check();
}

beforeEach(() => {
  mocks.queryRaw.mockReset().mockResolvedValue([{ "?column?": 1 }]);
  mocks.eventCount.mockReset().mockResolvedValue(0);
  mocks.outboxStats.mockReset().mockResolvedValue({ backlog: 0, oldestUnsyncedMs: null });
  mocks.evidenceHealth.droppedT1 = 0;
  mocks.evidenceHealth.lastDropAt = null;
  mocks.evidenceHealth.outboxUnavailable = false;
  mocks.env.AUTH_SECRET = "0123456789abcdef";
  mocks.env.AUTH_MODE = "dev";
});

describe("providers static-mut · database probe string + bounded latency (re-evaluated per mutant)", () => {
  it("L17 · probes with the literal `SELECT 1` template, not an empty query", async () => {
    await freshRun("database");
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    // Tagged-template call: first arg is the cooked TemplateStringsArray.
    const strings = mocks.queryRaw.mock.calls[0]![0] as unknown as string[];
    expect(Array.from(strings)).toEqual(["SELECT 1"]);
    expect(strings.join("")).toBe("SELECT 1");
  });

  it("L18 · UP latency is Date.now() - t (small, non-negative), never the summed clock", async () => {
    const r = await freshRun("database");
    expect(r.status).toBe("UP");
    expect(r.reason).toBe("reachable");
    expect(typeof r.latencyMs).toBe("number");
    expect(r.latencyMs!).toBeGreaterThanOrEqual(0);
    // Date.now() + t would be ~2× the epoch (>1e12 ms); real elapsed is a few ms.
    expect(r.latencyMs!).toBeLessThan(60_000);
  });

  it("L20 · DOWN latency is Date.now() - t too, not the summed clock", async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error("connection refused"));
    const r = await freshRun("database");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("connection refused");
    expect(r.latencyMs!).toBeGreaterThanOrEqual(0);
    expect(r.latencyMs!).toBeLessThan(60_000);
  });
});

describe("providers static-mut · static infra declare an empty dependency array (re-evaluated per mutant)", () => {
  it("L53 · streaming.dependencies is exactly []", async () => {
    expect((await freshProvider("streaming")).dependencies).toEqual([]);
  });
  it("L61 · auth.dependencies is exactly []", async () => {
    expect((await freshProvider("auth")).dependencies).toEqual([]);
  });
  it("L70 · rate-limiter.dependencies is exactly []", async () => {
    expect((await freshProvider("rate-limiter")).dependencies).toEqual([]);
  });
});

// Exact reason / activatesIn / capabilities for every unbuilt engine (the ENGINES table
// literals, L78–L84) plus the shared empty dependency array on the engine registration (L88).
const ENGINE_EXPECT: Record<string, { reason: string; activatesIn: string; capabilities: string[] }> = {
  "knowledge-graph": { reason: "not built", activatesIn: "Phase 2", capabilities: ["concept links", "prerequisites"] },
  "digital-twin": { reason: "not built", activatesIn: "Phase 2", capabilities: ["learner model"] },
  mastery: { reason: "not built", activatesIn: "Phase 2", capabilities: ["skill mastery estimates"] },
  recommendation: { reason: "not built", activatesIn: "Phase 3", capabilities: ["next-topic"] },
  retrieval: { reason: "internal to /teach for now", activatesIn: "Phase 2", capabilities: ["RAG"] },
  personalization: { reason: "not built", activatesIn: "Phase 3", capabilities: ["adaptive pacing"] },
  memory: { reason: "canvas-scoped context only today", activatesIn: "Phase 2", capabilities: ["long-term memory"] },
};

describe("providers static-mut · every engine's exact NOT_INSTALLED report + empty deps (re-evaluated per mutant)", () => {
  for (const [name, exp] of Object.entries(ENGINE_EXPECT)) {
    it(`${name}: exact reason / activatesIn / capabilities and empty dependencies`, async () => {
      const p = await freshProvider(name);
      // L88 · engine registration declares no dependencies.
      expect(p.dependencies).toEqual([]);
      // L78–L84 · the exact literal report this engine closes over.
      expect(await p.check()).toEqual({
        status: "NOT_INSTALLED",
        reason: exp.reason,
        evidence: { activatesIn: exp.activatesIn, capabilities: exp.capabilities },
      });
    });
  }
});
