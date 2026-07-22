import { prisma } from "@/server/db";
import { register } from "@/server/health/registry";
import type { HealthReport } from "@/server/health/types";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { isAcyclic as depAcyclic } from "@/server/knowledge/graph/dependency";
import { isAcyclic as compAcyclic } from "@/server/knowledge/graph/composition";
import { trustRank } from "@/server/knowledge/types";

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

// ── knowledge-store — reachable + latency ──
register({
  name: "knowledge-store", kind: "engine", dependencies: ["database"],
  async check(): Promise<HealthReport> {
    const t = Date.now();
    try {
      await createPostgresStore().listConcepts("PUBLIC");
      return { status: "UP", latencyMs: Date.now() - t, reason: "knowledge store reachable" };
    } catch {
      return notInstalled("knowledge tables not pushed yet");
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
    } catch {
      return notInstalled("knowledge tables not pushed yet");
    }
  },
});

// ── trust-pipeline — nothing above AUTO_VALIDATED without a human ReviewEvent, else UNSAFE ──
register({
  name: "trust-pipeline", kind: "engine", dependencies: ["knowledge-store"],
  async check(): Promise<HealthReport> {
    try {
      const floor = trustRank("AUTO_VALIDATED");
      const promoted = await prisma.statement.findMany({ where: {}, select: { id: true, trustLevel: true } });
      let unbacked = 0;
      for (const s of promoted) {
        if (trustRank(s.trustLevel as never) <= floor) continue;
        const review = await prisma.reviewEvent.count({ where: { targetKind: "Statement", targetId: s.id, decision: { in: ["PROMOTE", "APPROVE"] } } });
        if (review === 0) unbacked++;
      }
      if (unbacked > 0) return { status: "UNSAFE", reason: `${unbacked} statements above AUTO_VALIDATED with no human ReviewEvent`, evidence: { unbacked } };
      return { status: "UP", reason: "every promotion above the floor is human-backed", evidence: { unbacked } };
    } catch {
      return notInstalled("knowledge tables not pushed yet");
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
