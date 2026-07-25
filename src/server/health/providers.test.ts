import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Hard tests for the core health providers (src/server/health/providers.ts).
 *
 * These providers self-register via `register()` at import time and their real
 * decision logic lives inside each `check()`. We mock ONLY the narrowest I/O
 * edges — the Prisma client, `@/env`, evidence-health accessor, and the outbox
 * stats reader — via vi.hoisted mutable state, then drive every branch through
 * the REAL registered check functions and assert the EXACT report each returns.
 * Nothing about the branching logic under test is mocked.
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
import type { ComponentReport } from "@/server/health/registry";
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
  // Restore the "healthy" baseline before every test so each branch is set explicitly.
  mocks.queryRaw.mockReset().mockResolvedValue([{ "?column?": 1 }]);
  mocks.eventCount.mockReset().mockResolvedValue(0);
  mocks.outboxStats.mockReset().mockResolvedValue({ backlog: 0, oldestUnsyncedMs: null });
  mocks.evidenceHealth.droppedT1 = 0;
  mocks.evidenceHealth.lastDropAt = null;
  mocks.evidenceHealth.outboxUnavailable = false;
  mocks.env.AUTH_SECRET = "0123456789abcdef";
  mocks.env.AUTH_MODE = "dev";
});

describe("health/providers · registration", () => {
  it("registers every real infrastructure component under the SAME interface", () => {
    const infra = new Map(
      providers()
        .filter((p) => p.kind === "infrastructure")
        .map((p) => [p.name, p]),
    );
    for (const n of ["database", "event-pipeline", "provider-chain", "streaming", "auth", "rate-limiter"]) {
      expect(infra.has(n), `missing infra provider ${n}`).toBe(true);
    }
    // Dependency edges are declared exactly, not blank.
    expect(provider("event-pipeline").dependencies).toEqual(["database"]);
    expect(provider("provider-chain").dependencies).toEqual(["database"]);
    expect(provider("database").dependencies).toEqual([]);
  });

  it("registers all seven unbuilt engines as engines, never as infra", () => {
    const engines = providers().filter((p) => p.kind === "engine").map((p) => p.name);
    expect(new Set(engines)).toEqual(
      new Set(["knowledge-graph", "digital-twin", "mastery", "recommendation", "retrieval", "personalization", "memory"]),
    );
  });
});

describe("health/providers · database", () => {
  it("UP with real reason + non-negative latency when SELECT 1 resolves", async () => {
    const r = await run("database");
    expect(r.status).toBe("UP");
    expect(r.reason).toBe("reachable");
    expect(typeof r.latencyMs).toBe("number");
    expect(r.latencyMs!).toBeGreaterThanOrEqual(0);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("DOWN and surfaces the Error message when the query throws an Error", async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error("connection refused"));
    const r = await run("database");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("connection refused");
    expect(r.latencyMs!).toBeGreaterThanOrEqual(0);
  });

  it("DOWN with 'unreachable' when a non-Error is thrown (hostile reject value)", async () => {
    mocks.queryRaw.mockRejectedValueOnce("not-an-error-object");
    const r = await run("database");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("unreachable");
  });
});

describe("health/providers · event-pipeline", () => {
  it("UNSAFE when Tier-1 evidence was dropped — dominates a clean outbox", async () => {
    mocks.evidenceHealth.droppedT1 = 3;
    mocks.evidenceHealth.lastDropAt = 1700;
    const r = await run("event-pipeline");
    expect(r.status).toBe("UNSAFE");
    expect(r.reason).toBe("dropped Tier-1: 3, outboxUnavailable: false");
    expect(r.evidence).toMatchObject({ droppedT1: 3, outboxUnavailable: false, backlog: 0, oldestUnsyncedMs: null, lastDropAt: 1700 });
  });

  it("UNSAFE when the outbox is unavailable even with zero drops", async () => {
    mocks.evidenceHealth.outboxUnavailable = true;
    const r = await run("event-pipeline");
    expect(r.status).toBe("UNSAFE");
    expect(r.reason).toBe("dropped Tier-1: 0, outboxUnavailable: true");
  });

  it("DOWN when the Outbox cannot be read (stats reject → backlog -1)", async () => {
    mocks.outboxStats.mockRejectedValueOnce(new Error("db gone"));
    const r = await run("event-pipeline");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("cannot read Outbox");
    expect(r.evidence).toMatchObject({ backlog: -1 });
  });

  it("DEGRADED when the backlog exceeds the threshold (51 > 50)", async () => {
    mocks.outboxStats.mockResolvedValueOnce({ backlog: 51, oldestUnsyncedMs: 999 });
    const r = await run("event-pipeline");
    expect(r.status).toBe("DEGRADED");
    expect(r.reason).toBe("Outbox backlog 51");
  });

  it("UP at the exact threshold boundary — backlog 50 is NOT degraded", async () => {
    mocks.outboxStats.mockResolvedValueOnce({ backlog: 50, oldestUnsyncedMs: 1 });
    const r = await run("event-pipeline");
    expect(r.status).toBe("UP");
    expect(r.reason).toBe("no dropped Tier-1, Outbox drained");
  });

  it("UP when drained and clean", async () => {
    const r = await run("event-pipeline");
    expect(r.status).toBe("UP");
    expect(r.reason).toBe("no dropped Tier-1, Outbox drained");
  });
});

describe("health/providers · provider-chain", () => {
  it("DOWN when evidence cannot be read (count rejects → -1)", async () => {
    mocks.eventCount.mockRejectedValueOnce(new Error("boom"));
    const r = await run("provider-chain");
    expect(r.status).toBe("DOWN");
    expect(r.reason).toBe("cannot read evidence");
  });

  it("INSUFFICIENT_DATA when nothing served in the window, exposing the window length", async () => {
    mocks.eventCount.mockResolvedValueOnce(0);
    const r = await run("provider-chain");
    expect(r.status).toBe("INSUFFICIENT_DATA");
    expect(r.reason).toBe("no lessons served in the window yet");
    expect(r.evidence).toEqual({ windowMs: 60 * 60 * 1000 });
  });

  it("UP with the served count when the chain has recent evidence", async () => {
    mocks.eventCount.mockResolvedValueOnce(7);
    const r = await run("provider-chain");
    expect(r.status).toBe("UP");
    expect(r.reason).toBe("7 chunks served in the last hour");
    expect(r.evidence).toEqual({ served: 7 });
  });

  it("queries the RIGHT evidence: provider.used within a 1h rolling window", async () => {
    const before = Date.now() - 60 * 60 * 1000;
    mocks.eventCount.mockResolvedValueOnce(1);
    await run("provider-chain");
    const after = Date.now() - 60 * 60 * 1000;
    expect(mocks.eventCount).toHaveBeenCalledTimes(1);
    const arg = mocks.eventCount.mock.calls[0]![0] as { where: { type: string; createdAt: { gt: Date } } };
    expect(arg.where.type).toBe("provider.used");
    const gt = arg.where.createdAt.gt.getTime();
    expect(gt).toBeGreaterThanOrEqual(before);
    expect(gt).toBeLessThanOrEqual(after);
  });
});

describe("health/providers · static components", () => {
  it("streaming is always UP with its mounted-route reason", async () => {
    expect(await run("streaming")).toEqual({ status: "UP", reason: "NDJSON teach route mounted" });
  });

  it("rate-limiter is always UP", async () => {
    expect(await run("rate-limiter")).toEqual({ status: "UP", reason: "in-memory sliding window active" });
  });
});

describe("health/providers · auth", () => {
  it("UP and echoes the mode when the secret is strong enough", async () => {
    mocks.env.AUTH_MODE = "clerk";
    const r = await run("auth");
    expect(r).toEqual({ status: "UP", reason: "mode clerk" });
  });

  it("UP at the exact 16-char boundary", async () => {
    mocks.env.AUTH_SECRET = "x".repeat(16);
    expect((await run("auth")).status).toBe("UP");
  });

  it("DEGRADED just below the boundary (15 chars)", async () => {
    mocks.env.AUTH_SECRET = "x".repeat(15);
    const r = await run("auth");
    expect(r).toEqual({ status: "DEGRADED", reason: "AUTH_SECRET too weak" });
  });

  it("DEGRADED for an empty secret", async () => {
    mocks.env.AUTH_SECRET = "";
    expect((await run("auth")).status).toBe("DEGRADED");
  });
});

describe("health/providers · unbuilt engines", () => {
  it("report NOT_INSTALLED honestly with activation evidence, never fake-green", async () => {
    const r = await run("knowledge-graph");
    expect(r.status).toBe("NOT_INSTALLED");
    expect(r.reason).toBe("not built");
    expect(r.evidence).toEqual({ activatesIn: "Phase 2", capabilities: ["concept links", "prerequisites"] });
  });

  it("every engine declares NOT_INSTALLED — no engine ever claims UP", async () => {
    const engineReports: ComponentReport[] = await Promise.all(
      providers()
        .filter((p) => p.kind === "engine")
        .map(async (p) => ({ name: p.name, kind: p.kind, dependencies: p.dependencies, ...(await p.check()) })),
    );
    expect(engineReports.length).toBe(7);
    for (const rep of engineReports) {
      expect(rep.status, `${rep.name} must be NOT_INSTALLED`).toBe("NOT_INSTALLED");
    }
  });
});
