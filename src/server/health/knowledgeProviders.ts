import { prisma } from "@/server/db";
import { register } from "@/server/health/registry";
import type { HealthReport } from "@/server/health/types";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { isAcyclic as depAcyclic } from "@/server/knowledge/graph/dependency";
import { isAcyclic as compAcyclic } from "@/server/knowledge/graph/composition";
import { TRUST_LEVELS, trustRank } from "@/server/knowledge/types";

/**
 * Knowledge-platform health providers (§28). Woven onto the EXISTING framework — no new
 * dependency. Every provider PROBES live: until the gated knowledge/observation db pushes
 * happen, the tables do not exist, so the probe fails and the provider reports NOT_INSTALLED
 * (a declared engine, never fake-green). They auto-activate the moment the push lands.
 *
 * The load-bearing one is knowledge-integrity: if the graph has a cycle or a statement above
 * MACHINE_PROPOSED lacks provenance, it is UNSAFE — the platform must not serve unjustifiable
 * knowledge, so teaching degrades to ungrounded (grounding already falls back on any store
 * failure, M5). Metrics ride the evidence spine (knowledge.miss / teaching.miss).
 */

/** A missing-table error means the gated push hasn't run — report NOT_INSTALLED, not DOWN. */
function notInstalled(reason: string): HealthReport {
  return { status: "NOT_INSTALLED", reason, evidence: { activatesIn: "after the M0 knowledge db push (A-2)" } };
}

/**
 * The gated push not having run shows up as an undefined-table error (Postgres 42P01,
 * Prisma P2021). ONLY that means "not built yet". Any other failure — a dropped connection,
 * a malformed row, a query that throws mid-integrity-check — must NOT be laundered into a
 * benign NOT_INSTALLED, or a real breach reads as green (defeats §28, the whole point). So we
 * classify: missing table → NOT_INSTALLED, everything else → DOWN (probe failed, told honestly).
 */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  return e?.code === "P2021" || e?.meta?.code === "42P01" || /relation .* does not exist|does not exist/i.test(e?.message ?? "");
}

/** Route a caught probe error: not-pushed-yet is NOT_INSTALLED; anything else is an honest DOWN. */
function classify(err: unknown): HealthReport {
  if (isMissingTable(err)) return notInstalled("knowledge tables not pushed yet");
  return { status: "DOWN", reason: `knowledge probe failed: ${err instanceof Error ? err.message : String(err)}` };
}

// ── knowledge-store — reachable + latency ──
register({
  name: "knowledge-store", kind: "engine", dependencies: ["database"],
  async check(): Promise<HealthReport> {
    const t = Date.now();
    try {
      await createPostgresStore().listConcepts("PUBLIC");
      return { status: "UP", latencyMs: Date.now() - t, reason: "knowledge store reachable" };
    } catch (err) {
      return classify(err);
    }
  },
});

// ── knowledge-integrity — 0 cycles + 0 missing provenance, else UNSAFE ──
register({
  name: "knowledge-integrity", kind: "engine", dependencies: ["knowledge-store"],
  async check(): Promise<HealthReport> {
    try {
      const store = createPostgresStore();
      const [deps, comps] = await Promise.all([store.dependencyEdges(), store.compositionEdges()]);
      const cyclesOk = depAcyclic(deps) && compAcyclic(comps);
      // statements above MACHINE_PROPOSED that have NO provenance row (S4)
      const missingProvenance = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM "Statement" s
        WHERE s."trustLevel" <> 'MACHINE_PROPOSED'
          AND NOT EXISTS (SELECT 1 FROM "Provenance" p WHERE p."statementId" = s.id)`;
      const missing = Number(missingProvenance[0]?.count ?? 0);
      const evidence = { cyclesOk, missingProvenance: missing };
      if (!cyclesOk || missing > 0) {
        return { status: "UNSAFE", reason: `integrity breach — cycles:${!cyclesOk} missingProvenance:${missing}; teaching degrades to ungrounded`, evidence };
      }
      return { status: "UP", reason: "0 cycles, 0 missing provenance", evidence };
    } catch (err) {
      return classify(err);
    }
  },
});

// ── trust-pipeline — nothing above AUTO_VALIDATED without a human ReviewEvent, else UNSAFE ──
register({
  name: "trust-pipeline", kind: "engine", dependencies: ["knowledge-store"],
  async check(): Promise<HealthReport> {
    try {
      // One bounded aggregate — never load-all-then-count-per-row (that was O(rows) round-trips,
      // an unauthenticated health hit could stampede the DB). The ladder rungs above the human
      // floor are known at compile time, so the filter is a fixed IN-list, not a per-row rank test.
      const floor = trustRank("AUTO_VALIDATED");
      const aboveFloor = TRUST_LEVELS.filter((l) => trustRank(l) > floor);
      const rows = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM "Statement" s
        WHERE s."trustLevel" = ANY(${aboveFloor})
          AND NOT EXISTS (
            SELECT 1 FROM "ReviewEvent" r
            WHERE r."targetKind" = 'Statement' AND r."targetId" = s.id
              AND r.decision IN ('PROMOTE', 'APPROVE'))`;
      const unbacked = Number(rows[0]?.count ?? 0);
      if (unbacked > 0) return { status: "UNSAFE", reason: `${unbacked} statements above AUTO_VALIDATED with no human ReviewEvent`, evidence: { unbacked } };
      return { status: "UP", reason: "every promotion above the floor is human-backed", evidence: { unbacked } };
    } catch (err) {
      return classify(err);
    }
  },
});

// ── ingestion — the pipeline is synchronous in Phase 2; no queue to back up (honest NOT_INSTALLED) ──
register({
  name: "ingestion", kind: "engine", dependencies: [],
  async check(): Promise<HealthReport> {
    return { status: "NOT_INSTALLED", reason: "ingestion runs synchronously — no backlog queue in Phase 2", evidence: { activatesIn: "when a background ingestion queue is added" } };
  },
});

// ── observation-store — a SEPARATE instance (§17.1); NOT_INSTALLED until its own push + client ──
register({
  name: "observation-store", kind: "engine", dependencies: [],
  async check(): Promise<HealthReport> {
    return { status: "NOT_INSTALLED", reason: "observation store is a separate DB — needs its own push + generated client (M8)", evidence: { activatesIn: "after the M8 observation db push" } };
  },
});
