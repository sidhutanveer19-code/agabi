import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Mutation-killing tests for src/server/health/providers.ts.
 *
 * Companion to providers.test.ts — pins the EXACT values Stryker mutants flip:
 *  - the literal `SELECT 1` probe string (StringLiteral -> ``),
 *  - the `Date.now() - t` latency arithmetic in both DB branches (ArithmeticOperator -> +),
 *  - the empty `dependencies: []` arrays on the static infra providers and every engine
 *    (ArrayDeclaration -> ["Stryker was here"]),
 *  - each unbuilt engine's exact reason / activatesIn / capabilities
 *    (StringLiteral -> "", ArrayDeclaration -> []).
 *
 * Only the narrowest I/O edges are faked (Prisma, @/env, evidence health, outbox);
 * every assertion drives the REAL registered check().
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

// Side-effect import registers all providers into the shared registry.
import "@/server/health/providers";
import { providers } from "@/server/health/registry";
import type { HealthProvider, HealthReport } from "@/server/health/types";

function provider(name: string): HealthProvider {
  const p = providers().find((x) => x.name === name);
  if (!p) throw new Error(`provider "${name}" not registered`);
  return p;
}
async function run(name: string): Promise<HealthReport> {
  return provider(name).check();
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

describe("providers.mut · database probe string + bounded latency", () => {
  it("probes with the literal `SELECT 1` template, not an empty query (L17)", async () => {
    await run("database");
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    // Tagged-template call: first arg is the cooked TemplateStringsArray.
    const strings = mocks.queryRaw.mock.calls[0]![0] as unknown as string[];
    expect(Array.from(strings)).toEqual(["SELECT 1"]);
    expect(strings.join("")).toBe("SELECT 1");
  });

  it("UP latency is elapsed (Date.now() - t): small & non-negative, never the summed clock (L18)", async () => {
    const r = await run("database");
    expect(r.status).toBe("UP");
    expect(r.reason).toBe("reachable");
    expect(typeof r.latencyMs).toBe("number");
    expect(r.latencyMs!).toBeGreaterThanOrEqual(0);
    // Date.now() + t would be ~2× the epoch (>1e12 ms); real elapsed is a few ms.
    expect(r.latencyMs!).toBeLessThan(60_000);
  });

  it("DOWN latency is elapsed too, not the summed clock (L20)", async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error("connection refused"));
    const r = await run("database");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("connection refused");
    expect(r.latencyMs!).toBeGreaterThanOrEqual(0);
    expect(r.latencyMs!).toBeLessThan(60_000);
  });
});

describe("providers.mut · static infra declare NO dependencies", () => {
  it("streaming declares an empty dependency array (L53)", () => {
    expect(provider("streaming").dependencies).toEqual([]);
  });
  it("auth declares an empty dependency array (L61)", () => {
    expect(provider("auth").dependencies).toEqual([]);
  });
  it("rate-limiter declares an empty dependency array (L70)", () => {
    expect(provider("rate-limiter").dependencies).toEqual([]);
  });
});

// Exact reason / activatesIn / capabilities for every unbuilt engine (L79–L85),
// plus the shared empty dependency array on the engine registration (L88).
const ENGINE_EXPECT: Record<string, { reason: string; activatesIn: string; capabilities: string[] }> = {
  "knowledge-graph": { reason: "not built", activatesIn: "Phase 2", capabilities: ["concept links", "prerequisites"] },
  "digital-twin": { reason: "not built", activatesIn: "Phase 2", capabilities: ["learner model"] },
  mastery: { reason: "not built", activatesIn: "Phase 2", capabilities: ["skill mastery estimates"] },
  recommendation: { reason: "not built", activatesIn: "Phase 3", capabilities: ["next-topic"] },
  retrieval: { reason: "internal to /teach for now", activatesIn: "Phase 2", capabilities: ["RAG"] },
  personalization: { reason: "not built", activatesIn: "Phase 3", capabilities: ["adaptive pacing"] },
  memory: { reason: "canvas-scoped context only today", activatesIn: "Phase 2", capabilities: ["long-term memory"] },
};

describe("providers.mut · every engine's exact NOT_INSTALLED report + empty deps", () => {
  for (const [name, exp] of Object.entries(ENGINE_EXPECT)) {
    it(`${name}: exact reason/activatesIn/capabilities and empty dependencies`, async () => {
      expect(await run(name)).toEqual({
        status: "NOT_INSTALLED",
        reason: exp.reason,
        evidence: { activatesIn: exp.activatesIn, capabilities: exp.capabilities },
      });
      expect(provider(name).dependencies).toEqual([]);
    });
  }
});
