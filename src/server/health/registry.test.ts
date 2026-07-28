import { describe, it, expect, vi } from "vitest";
import type { ComponentReport } from "@/server/health/registry";
import type { HealthProvider, HealthReport } from "@/server/health/types";

/**
 * Hard branch tests for src/server/health/registry.ts.
 *
 * This module has NO I/O boundary — it imports only `import type` (erased at
 * runtime), so there is nothing to stub away (§H1.7). The natural seam is the
 * injected `HealthProvider.check`: checkAll consumes whatever providers the
 * registry holds, so we hand it fake providers with controlled check() outcomes
 * and assert the EXACT ComponentReport / aggregate result for every path.
 *
 * `REGISTRY` is a module-level singleton, so every registry-stateful test loads
 * a FRESH module instance (vi.resetModules + dynamic import) — each test runs in
 * its own disposable registry (§H1.6 REAL + ISOLATED). `aggregate` is pure and
 * takes its reports as an argument, so those tests build reports directly.
 */

// ── helpers ────────────────────────────────────────────────────────────────
type RegistryModule = typeof import("@/server/health/registry");

/** A fresh, empty registry per call — no cross-test leakage through the singleton. */
async function loadFresh(): Promise<RegistryModule> {
  vi.resetModules();
  return import("@/server/health/registry");
}

function makeProvider(
  over: Partial<HealthProvider> & Pick<HealthProvider, "name">,
): HealthProvider {
  return {
    name: over.name,
    kind: over.kind ?? "engine",
    dependencies: over.dependencies ?? [],
    check: over.check ?? (async () => ({ status: "UP", reason: "ok" })),
  };
}

function report(over: Partial<ComponentReport> = {}): ComponentReport {
  return { name: "c", kind: "engine", dependencies: [], status: "UP", reason: "ok", ...over };
}

// ── register / providers ─────────────────────────────────────────────────────
describe("register + providers", () => {
  it("empty registry → providers() returns []", async () => {
    const { providers } = await loadFresh();
    expect(providers()).toEqual([]);
  });

  it("register(one) → providers() returns exactly that provider (insertion order)", async () => {
    const { register, providers } = await loadFresh();
    const a = makeProvider({ name: "a" });
    const b = makeProvider({ name: "b" });
    register(a);
    register(b);
    const out = providers();
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(a); // Map preserves insertion order
    expect(out[1]).toBe(b);
  });

  it("register with a DUPLICATE name overwrites (last wins) — Map keyed by name", async () => {
    const { register, providers } = await loadFresh();
    const first = makeProvider({ name: "dup", dependencies: ["old"] });
    const second = makeProvider({ name: "dup", dependencies: ["new"] });
    register(first);
    register(second);
    const out = providers();
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(second);
    expect(out[0].dependencies).toEqual(["new"]);
  });

  it("providers() returns a fresh array copy, not the live Map view", async () => {
    const { register, providers } = await loadFresh();
    register(makeProvider({ name: "a" }));
    const snapshot = providers();
    register(makeProvider({ name: "b" }));
    expect(snapshot).toHaveLength(1); // earlier snapshot unaffected by later register
    expect(providers()).toHaveLength(2);
  });
});

// ── checkAll ─────────────────────────────────────────────────────────────────
describe("checkAll — success mapping", () => {
  it("no providers → resolves to []", async () => {
    const { checkAll } = await loadFresh();
    expect(await checkAll()).toEqual([]);
  });

  it("maps EXACT provider identity + full report, forwards `deep` opts to check", async () => {
    const { register, checkAll } = await loadFresh();
    const check = vi.fn(
      async (): Promise<HealthReport> => ({
        status: "DEGRADED",
        reason: "slow",
        latencyMs: 42,
        errorRate: 0.1,
        lastSuccessAt: 123,
        since: 456,
        evidence: { q: 1 },
      }),
    );
    register(makeProvider({ name: "db", kind: "infrastructure", dependencies: ["net"], check }));

    const res = await checkAll({ deep: true });
    expect(res).toEqual([
      {
        name: "db",
        kind: "infrastructure",
        dependencies: ["net"],
        status: "DEGRADED",
        reason: "slow",
        latencyMs: 42,
        errorRate: 0.1,
        lastSuccessAt: 123,
        since: 456,
        evidence: { q: 1 },
      },
    ]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith({ deep: true });
  });

  it("default opts is {} — check receives the empty options object", async () => {
    const { register, checkAll } = await loadFresh();
    const check = vi.fn(async (): Promise<HealthReport> => ({ status: "UP", reason: "ok" }));
    register(makeProvider({ name: "x", check }));

    await checkAll();
    expect(check).toHaveBeenCalledWith({});
  });

  it("minimal report (status+reason only) → identity fields added, nothing invented", async () => {
    const { register, checkAll } = await loadFresh();
    register(
      makeProvider({
        name: "min",
        kind: "engine",
        dependencies: [],
        check: async () => ({ status: "NOT_INSTALLED", reason: "unbuilt" }),
      }),
    );
    const res = await checkAll();
    expect(res).toEqual([
      { name: "min", kind: "engine", dependencies: [], status: "NOT_INSTALLED", reason: "unbuilt" },
    ]);
  });
});

describe("checkAll — check() throws", () => {
  it("check throws an Error → DOWN report carrying the error message", async () => {
    const { register, checkAll } = await loadFresh();
    register(
      makeProvider({
        name: "boom",
        kind: "infrastructure",
        dependencies: ["d"],
        check: async () => {
          throw new Error("kaboom");
        },
      }),
    );
    const res = await checkAll();
    expect(res).toEqual([
      { name: "boom", kind: "infrastructure", dependencies: ["d"], status: "DOWN", reason: "kaboom" },
    ]);
  });

  it("check throws a NON-Error → reason falls back to 'check threw'", async () => {
    const { register, checkAll } = await loadFresh();
    register(
      makeProvider({
        name: "weird",
        kind: "engine",
        dependencies: [],
        check: async () => {
          throw "a bare string, not an Error";
        },
      }),
    );
    const res = await checkAll();
    expect(res).toEqual([
      { name: "weird", kind: "engine", dependencies: [], status: "DOWN", reason: "check threw" },
    ]);
  });

  it("mixed batch → order preserved, each row mapped by its own outcome", async () => {
    const { register, checkAll } = await loadFresh();
    register(makeProvider({ name: "ok", check: async () => ({ status: "UP", reason: "fine" }) }));
    register(
      makeProvider({
        name: "err",
        kind: "infrastructure",
        check: async () => {
          throw new Error("dead");
        },
      }),
    );
    register(
      makeProvider({ name: "deg", check: async () => ({ status: "DEGRADED", reason: "meh" }) }),
    );

    const res = await checkAll();
    expect(res).toEqual([
      { name: "ok", kind: "engine", dependencies: [], status: "UP", reason: "fine" },
      { name: "err", kind: "infrastructure", dependencies: [], status: "DOWN", reason: "dead" },
      { name: "deg", kind: "engine", dependencies: [], status: "DEGRADED", reason: "meh" },
    ]);
  });
});

// ── aggregate (pure) ─────────────────────────────────────────────────────────
describe("aggregate — single winning condition per branch", () => {
  it("empty reports → UP / all real components healthy", async () => {
    const { aggregate } = await loadFresh();
    expect(aggregate([])).toEqual({ status: "UP", reason: "all real components healthy" });
  });

  it("all UP → UP", async () => {
    const { aggregate } = await loadFresh();
    expect(aggregate([report({ status: "UP" }), report({ status: "UP" })])).toEqual({
      status: "UP",
      reason: "all real components healthy",
    });
  });

  it("NOT_INSTALLED / INSUFFICIENT_DATA only → still UP (none of the escalation branches fire)", async () => {
    const { aggregate } = await loadFresh();
    expect(
      aggregate([report({ status: "NOT_INSTALLED" }), report({ status: "INSUFFICIENT_DATA" })]),
    ).toEqual({ status: "UP", reason: "all real components healthy" });
  });

  it("any UNSAFE → UNSAFE", async () => {
    const { aggregate } = await loadFresh();
    expect(aggregate([report({ status: "UP" }), report({ status: "UNSAFE" })])).toEqual({
      status: "UNSAFE",
      reason: "Tier-1 evidence dropped or Outbox unavailable — refusing to trust history",
    });
  });

  it("infrastructure + DOWN → DOWN", async () => {
    const { aggregate } = await loadFresh();
    expect(aggregate([report({ kind: "infrastructure", status: "DOWN" })])).toEqual({
      status: "DOWN",
      reason: "a core component is down",
    });
  });

  it("ENGINE that is DOWN does NOT trip DOWN — kind guard is real (engine-DOWN alone → UP)", async () => {
    const { aggregate } = await loadFresh();
    // Real, surprising behavior: a non-infrastructure component being DOWN is not
    // itself a core outage. With nothing else set, the aggregate is UP.
    expect(aggregate([report({ kind: "engine", status: "DOWN" })])).toEqual({
      status: "UP",
      reason: "all real components healthy",
    });
  });

  it("infrastructure that is UP does NOT trip DOWN (status guard is real)", async () => {
    const { aggregate } = await loadFresh();
    expect(aggregate([report({ kind: "infrastructure", status: "UP" })])).toEqual({
      status: "UP",
      reason: "all real components healthy",
    });
  });

  it("extra.emptyProviderChain true → DEGRADED / no model provider configured", async () => {
    const { aggregate } = await loadFresh();
    expect(aggregate([report({ status: "UP" })], { emptyProviderChain: true })).toEqual({
      status: "DEGRADED",
      reason: "no model provider configured",
    });
  });

  it("extra present but emptyProviderChain false → not that branch (→ UP here)", async () => {
    const { aggregate } = await loadFresh();
    expect(aggregate([report({ status: "UP" })], { emptyProviderChain: false })).toEqual({
      status: "UP",
      reason: "all real components healthy",
    });
  });

  it("extra omitted entirely (optional-chain short-circuits) → not that branch", async () => {
    const { aggregate } = await loadFresh();
    expect(aggregate([report({ status: "UP" })])).toEqual({
      status: "UP",
      reason: "all real components healthy",
    });
  });

  it("a plain DEGRADED component → DEGRADED / a component is degraded", async () => {
    const { aggregate } = await loadFresh();
    expect(aggregate([report({ status: "UP" }), report({ status: "DEGRADED" })])).toEqual({
      status: "DEGRADED",
      reason: "a component is degraded",
    });
  });
});

describe("aggregate — precedence (the ladder is ordered, top wins)", () => {
  it("UNSAFE dominates infra-DOWN, emptyChain AND degraded all at once", async () => {
    const { aggregate } = await loadFresh();
    const reports = [
      report({ status: "UNSAFE" }),
      report({ kind: "infrastructure", status: "DOWN" }),
      report({ status: "DEGRADED" }),
    ];
    expect(aggregate(reports, { emptyProviderChain: true })).toEqual({
      status: "UNSAFE",
      reason: "Tier-1 evidence dropped or Outbox unavailable — refusing to trust history",
    });
  });

  it("infra-DOWN dominates emptyChain + degraded (no UNSAFE)", async () => {
    const { aggregate } = await loadFresh();
    const reports = [
      report({ kind: "infrastructure", status: "DOWN" }),
      report({ status: "DEGRADED" }),
    ];
    expect(aggregate(reports, { emptyProviderChain: true })).toEqual({
      status: "DOWN",
      reason: "a core component is down",
    });
  });

  it("emptyChain dominates a degraded component (distinct reason string proves which branch)", async () => {
    const { aggregate } = await loadFresh();
    const reports = [report({ status: "DEGRADED" })];
    // emptyChain branch (line 40) wins over the generic degraded branch (line 41):
    expect(aggregate(reports, { emptyProviderChain: true })).toEqual({
      status: "DEGRADED",
      reason: "no model provider configured",
    });
  });
});
