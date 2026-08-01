import { prisma } from "@/server/db";
import { env } from "@/env";
import { getEvidenceHealth } from "@/server/events";
import { outboxStats } from "@/server/evidence/outbox";
import { register } from "@/server/health/registry";
import type { HealthReport } from "@/server/health/types";

const OUTBOX_BACKLOG_DEGRADED = 50; // rows queued before we call the pipeline degraded
const PROVIDER_WINDOW_MS = 60 * 60 * 1000; // rolling baseline for "recently served"

// ── 1 · Database ──
register({
  name: "database", kind: "infrastructure", dependencies: [],
  async check(): Promise<HealthReport> {
    const t = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "UP", latencyMs: Date.now() - t, reason: "reachable" };
    } catch (e) {
      return { status: "DOWN", latencyMs: Date.now() - t, reason: e instanceof Error ? e.message : "unreachable" };
    }
  },
});

// ── 2 · Event pipeline — the flight recorder's own health. dropped-T1 MUST be zero. ──
register({
  name: "event-pipeline", kind: "infrastructure", dependencies: ["database"],
  async check(): Promise<HealthReport> {
    const { droppedT1, outboxUnavailable, lastDropAt } = getEvidenceHealth();
    const { backlog, oldestUnsyncedMs } = await outboxStats().catch(() => ({ backlog: -1, oldestUnsyncedMs: null }));
    const evidence = { droppedT1, outboxUnavailable, backlog, oldestUnsyncedMs, lastDropAt };
    if (droppedT1 > 0 || outboxUnavailable) return { status: "UNSAFE", reason: `dropped Tier-1: ${droppedT1}, outboxUnavailable: ${outboxUnavailable}`, evidence };
    if (backlog < 0) return { status: "DOWN", reason: "cannot read Outbox", evidence };
    if (backlog > OUTBOX_BACKLOG_DEGRADED) return { status: "DEGRADED", reason: `Outbox backlog ${backlog}`, evidence };
    return { status: "UP", reason: "no dropped Tier-1, Outbox drained", evidence };
  },
});

// ── 3 · Provider chain — evidence-derived (invariant 7); never imports advisors/. ──
register({
  name: "provider-chain", kind: "infrastructure", dependencies: ["database"],
  async check(): Promise<HealthReport> {
    const since = new Date(Date.now() - PROVIDER_WINDOW_MS);
    const served = await prisma.event.count({ where: { type: "provider.used", createdAt: { gt: since } } }).catch(() => -1);
    if (served < 0) return { status: "DOWN", reason: "cannot read evidence" };
    if (served === 0) return { status: "INSUFFICIENT_DATA", reason: "no lessons served in the window yet", evidence: { windowMs: PROVIDER_WINDOW_MS } };
    return { status: "UP", reason: `${served} chunks served in the last hour`, evidence: { served } };
  },
});

// ── 4 · Streaming pipeline ── (the NDJSON teach route). Nominal — a live probe would teach a lesson.
register({
  name: "streaming", kind: "infrastructure", dependencies: [],
  async check(): Promise<HealthReport> {
    return { status: "UP", reason: "NDJSON teach route mounted" };
  },
});

// ── 5 · Auth ──
register({
  name: "auth", kind: "infrastructure", dependencies: [],
  async check(): Promise<HealthReport> {
    const ok = env.AUTH_SECRET.length >= 16;
    return { status: ok ? "UP" : "DEGRADED", reason: ok ? `mode ${env.AUTH_MODE}` : "AUTH_SECRET too weak" };
  },
});

// ── 6 · Rate limiter ──
register({
  name: "rate-limiter", kind: "infrastructure", dependencies: [],
  async check(): Promise<HealthReport> {
    return { status: "UP", reason: "in-memory sliding window active" };
  },
});

// ── 7 · Unbuilt engines — declared NOT_INSTALLED, never faked. Appear automatically when built. ──
const ENGINES: { name: string; reason: string; activatesIn: string; capabilities: string[] }[] = [
  { name: "knowledge-graph", reason: "not built", activatesIn: "Phase 2", capabilities: ["concept links", "prerequisites"] },
  { name: "digital-twin", reason: "not built", activatesIn: "Phase 2", capabilities: ["learner model"] },
  { name: "mastery", reason: "not built", activatesIn: "Phase 2", capabilities: ["skill mastery estimates"] },
  { name: "recommendation", reason: "not built", activatesIn: "Phase 3", capabilities: ["next-topic"] },
  { name: "retrieval", reason: "internal to /teach for now", activatesIn: "Phase 2", capabilities: ["RAG"] },
  { name: "personalization", reason: "not built", activatesIn: "Phase 3", capabilities: ["adaptive pacing"] },
  { name: "memory", reason: "canvas-scoped context only today", activatesIn: "Phase 2", capabilities: ["long-term memory"] },
];
for (const e of ENGINES) {
  register({
    name: e.name, kind: "engine", dependencies: [],
    async check(): Promise<HealthReport> {
      return { status: "NOT_INSTALLED", reason: e.reason, evidence: { activatesIn: e.activatesIn, capabilities: e.capabilities } };
    },
  });
}
