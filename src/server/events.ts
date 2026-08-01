import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { tierFor, type Tier } from "@/server/evidence/taxonomy";
import { classify } from "@/server/evidence/failure";
import { log } from "@/server/log";

/**
 * The ONLY write path for events [I4] — the flight recorder. Append-only: emit +
 * purgeUser (erasure). Tiered durability (the FIX-2 matrix):
 *   permanent failure, any tier → DROP (+count, +UNSAFE if T1), log, LESSON CONTINUES.
 *   transient T1 → retry → Outbox → if Outbox also fails, THROW (lesson stops).
 *   transient T2 → retry → Outbox → stderr → continue.   T3 → drop + count.
 * A deterministic bad payload can never take down teaching; genuine T1 evidence
 * never vanishes silently (UNSAFE is raised, or the lesson stops).
 */
export type EventSource = "server" | "client";

/** D4 taxonomy — the fixed set we capture. Values mirror evidence/taxonomy.ts. */
export const EVENTS = {
  requestReceived: "request.received",
  commandSent: "command.sent", // = the routing decision (what the backend chose to do)
  lessonStarted: "lesson.started",
  lessonFinished: "lesson.finished",
  lessonCancelled: "lesson.cancelled",
  lessonState: "lesson.state",
  lessonCursor: "lesson.cursor",
  outlinePlanned: "outline.planned",
  outlineRepaired: "outline.repaired",
  slotFilled: "slot.filled",
  slotFailed: "slot.failed",
  providerUsed: "provider.used",
  shadowPlan: "shadow.plan",
  fillBudgetExhausted: "fill.budget.exhausted",
  slotBackfilled: "slot.backfilled",
  slotCoerced: "slot.coerced",
  blockEmitted: "block.emitted",
  blockFallback: "block.fallback",
  providerRatelimited: "provider.ratelimited",
  workspaceSaved: "workspace.saved",
  // Content-engineering pipeline (W1) — one per ingest stage, so a source's journey is replayable.
  ingestAcquired: "ingest.acquired",
  ingestParsed: "ingest.parsed",
  ingestNormalised: "ingest.normalised",
  ingestChunked: "ingest.chunked",
  ingestChunksPersisted: "ingest.chunks_persisted",
  ingestOmitted: "ingest.omitted",
  ingestDiscovered: "ingest.discovered",
  ingestExtracted: "ingest.extracted",
  ingestValidated: "ingest.validated",
  ingestEnqueued: "ingest.enqueued",
  error: "error",
} as const;

/** Client events we accept (the rest are server-emitted and unspoofable). */
export const CLIENT_EVENT_ALLOWLIST = new Set<string>([
  EVENTS.commandSent,
  "topic_opened",
  "lesson_started",
  "lesson_completed",
  "question_asked",
]);

/** Correlation + provenance carried on every event (the flight-recorder columns). */
export interface EmitMeta {
  conversationId?: string | null; // stable per (userId, canvasId) — canvas lifetime
  lessonId?: string | null;
  reqId?: string | null; // one HTTP request
  tier?: Tier; // defaulted from taxonomy by type
  eventVersion?: number;
  schemaVersion?: number;
  provenance?: unknown;
  causedByEventId?: string | null;
}

export interface EmitInput extends EmitMeta {
  userId: string;
  type: string;
  payload: unknown;
  source: EventSource;
}

function toJson(payload: unknown): Prisma.InputJsonValue {
  return (payload ?? {}) as Prisma.InputJsonValue;
}

// ── In-memory evidence health (read by Stage C health + detectors). ──
let droppedT1 = 0;
let lastDropAt: number | null = null;
let outboxUnavailable = false;
export function getEvidenceHealth() {
  return { droppedT1, lastDropAt, outboxUnavailable };
}
export function resetEvidenceHealth() {
  droppedT1 = 0;
  lastDropAt = null;
  outboxUnavailable = false;
}

type Row = EmitInput & { id: string; tier: Tier };

function buildRow(i: EmitInput): Row {
  return { ...i, id: crypto.randomUUID(), tier: i.tier ?? tierFor(i.type) };
}

function createData(r: Row) {
  return {
    id: r.id,
    userId: r.userId,
    type: r.type,
    payload: toJson(r.payload),
    source: r.source,
    tier: r.tier,
    conversationId: r.conversationId ?? null,
    lessonId: r.lessonId ?? null,
    reqId: r.reqId ?? null,
    eventVersion: r.eventVersion ?? 1,
    schemaVersion: r.schemaVersion ?? 1,
    provenance: r.provenance == null ? undefined : (r.provenance as Prisma.InputJsonValue),
    causedByEventId: r.causedByEventId ?? null,
  };
}

function drop(r: Row, reason: string, e: unknown) {
  if (r.tier === 1) { droppedT1++; lastDropAt = Date.now(); }
  log("error", "evidence.dropped", {
    userId: r.userId, conversationId: r.conversationId, lessonId: r.lessonId, reqId: r.reqId,
    message: `dropped ${r.type} (tier ${r.tier}): ${reason}`, type: r.type, tier: r.tier, payload: r.payload,
  }, e);
}

/** Route a failed write through the tier matrix. Throws only for transient-T1-with-dead-Outbox. */
async function handleFailure(r: Row, e: unknown): Promise<void> {
  if (classify(e) === "permanent") { drop(r, "permanent", e); return; } // lesson CONTINUES; UNSAFE if T1
  if (r.tier === 3) return; // best-effort transient → drop quietly

  // transient T1/T2: retry once, then Outbox.
  try {
    await prisma.event.create({ data: createData(r) });
    return;
  } catch {
    /* retry failed — fall through to Outbox */
  }
  try {
    await prisma.outbox.create({
      data: {
        id: r.id, userId: r.userId, tier: r.tier, type: r.type, payload: toJson(r.payload),
        conversationId: r.conversationId ?? null, lessonId: r.lessonId ?? null, reqId: r.reqId ?? null,
        eventVersion: r.eventVersion ?? 1, schemaVersion: r.schemaVersion ?? 1,
        provenance: r.provenance == null ? undefined : (r.provenance as Prisma.InputJsonValue),
        causedByEventId: r.causedByEventId ?? null,
      },
    });
    outboxUnavailable = false;
  } catch (outboxErr) {
    outboxUnavailable = true;
    if (r.tier === 1) {
      droppedT1++; lastDropAt = Date.now();
      throw new Error(`Tier-1 evidence unrecordable (Event + Outbox both failed) for ${r.type}`);
    }
    log("error", "evidence.outbox_failed", { userId: r.userId, type: r.type, tier: r.tier }, outboxErr);
  }
}

export async function emit(userId: string, type: string, payload: unknown, source: EventSource, meta: EmitMeta = {}): Promise<string> {
  const r = buildRow({ userId, type, payload, source, ...meta });
  try {
    await prisma.event.create({ data: createData(r) });
  } catch (e) {
    await handleFailure(r, e);
  }
  return r.id; // caller learns the id (for causedByEventId chains) even if it queued/dropped
}

/** Batched emit — one round-trip for a chunk's Tier-1 events. On batch failure the
 *  whole batch is replayed through the per-event matrix (so each row's tier decides). */
export async function emitMany(inputs: EmitInput[]): Promise<string[]> {
  if (inputs.length === 0) return [];
  const rows = inputs.map(buildRow);
  try {
    await prisma.event.createMany({ data: rows.map(createData) });
  } catch (e) {
    for (const r of rows) await handleFailure(r, e);
  }
  return rows.map((r) => r.id);
}

/** The one exception to append-only — full erasure for a single user [I4] (DPDP). */
export async function purgeUser(userId: string): Promise<number> {
  const [ev, ob] = await Promise.all([
    prisma.event.deleteMany({ where: { userId } }),
    prisma.outbox.deleteMany({ where: { userId } }),
  ]);
  return ev.count + ob.count;
}
