/**
 * Every event must justify its existence (invariant 1). For each EVENTS key this
 * declares: tier, consumer(s), the question it answers, and whether it is actually
 * emitted yet. `taxonomy.test.ts` enforces BOTH directions — declared ⇒ emitted
 * (reciprocal), and emitted ⇒ declared — so a dead event with a paper consumer
 * cannot hide.
 *
 * Keyed by the EVENTS key NAME (camelCase) so the reciprocal test can grep
 * `EVENTS.<key>`; `value` mirrors the dotted wire string (kept in sync by the test,
 * NOT imported here — that would cycle with events.ts, which imports `tierFor`).
 */
export type Tier = 1 | 2 | 3;

export interface EventDecl {
  value: string; // the dotted type string emit() receives, e.g. "lesson.started"
  tier: Tier;
  consumers: string[]; // who reads it (replay / health / quality / a detector)
  question: string; // what it answers
  emitter: string; // where it fires, or "none-yet"
  activatesIn?: string; // required iff emitter === "none-yet"
}

export const TAXONOMY = {
  // ── Tier 1 — reconstruction-critical, never lost ──
  requestReceived: { value: "request.received", tier: 1, consumers: ["replay"], question: "what did the student ask, verbatim?", emitter: "manager.run" },
  commandSent: { value: "command.sent", tier: 1, consumers: ["replay"], question: "what did the backend decide to do (routing)?", emitter: "manager.run" },
  lessonStarted: { value: "lesson.started", tier: 1, consumers: ["replay", "health"], question: "when did a lesson begin?", emitter: "manager.run" },
  lessonFinished: { value: "lesson.finished", tier: 1, consumers: ["replay", "quality", "health"], question: "how did the lesson end + why (report)?", emitter: "manager.teachChunk/run" },
  lessonCancelled: { value: "lesson.cancelled", tier: 1, consumers: ["replay", "health"], question: "was the lesson abandoned mid-teach?", emitter: "manager.run" },
  lessonState: { value: "lesson.state", tier: 1, consumers: ["replay"], question: "which state transition happened?", emitter: "manager (setState wrapper)" },
  lessonCursor: { value: "lesson.cursor", tier: 1, consumers: ["replay"], question: "how far did teaching advance (READY only)?", emitter: "manager (advanceCursor wrapper)" },
  error: { value: "error", tier: 1, consumers: ["replay", "detector:errors"], question: "what threw during a lesson?", emitter: "manager.run" },

  // ── Tier 2 — degradation evidence, retry→queue→continue ──
  outlinePlanned: { value: "outline.planned", tier: 2, consumers: ["replay"], question: "what outline was planned?", emitter: "manager.startLesson" },
  outlineRepaired: { value: "outline.repaired", tier: 2, consumers: ["replay", "quality"], question: "what did repairOutline change?", emitter: "manager.startLesson" },
  slotFilled: { value: "slot.filled", tier: 2, consumers: ["replay", "quality"], question: "which slot filled, by which provider, at which rung?", emitter: "manager.teachChunk" },
  slotFailed: { value: "slot.failed", tier: 2, consumers: ["replay", "quality", "detector:all-skeleton"], question: "which slot could not be filled (minimal/skipped)?", emitter: "manager.teachChunk" },
  providerUsed: { value: "provider.used", tier: 2, consumers: ["health:provider-chain"], question: "which provider served this chunk?", emitter: "manager.teachChunk" },

  // ── Tier 3 — best-effort ──
  workspaceSaved: { value: "workspace.saved", tier: 3, consumers: ["ops"], question: "was a canvas autosaved?", emitter: "api/workspace/[id]" },

  // ── Content-engineering pipeline (W1) — a source's journey through the factory ──
  ingestAcquired: { value: "ingest.acquired", tier: 2, consumers: ["replay", "health:ingestion"], question: "which source was acquired (licence-cleared) for ingestion?", emitter: "ingest.orchestrator" },
  ingestParsed: { value: "ingest.parsed", tier: 2, consumers: ["replay"], question: "how many spans did parsing yield?", emitter: "ingest.orchestrator" },
  ingestNormalised: { value: "ingest.normalised", tier: 2, consumers: ["replay"], question: "did clean+normalise run over the document?", emitter: "ingest.orchestrator" },
  ingestChunked: { value: "ingest.chunked", tier: 2, consumers: ["replay", "coverage"], question: "how many chunks were produced (the coverage denominator)?", emitter: "ingest.orchestrator" },
  ingestChunksPersisted: { value: "ingest.chunks_persisted", tier: 2, consumers: ["replay", "review:queue"], question: "were the source and its chunks stored, so provenance resolves and review can show the passage?", emitter: "ingest.orchestrator" },
  ingestOmitted: { value: "ingest.omitted", tier: 2, consumers: ["replay", "quality", "coverage"], question: "what did this ingest drop, reject or skip, and for what reason (R1 — never silently skip)?", emitter: "ingest.orchestrator" },
  ingestDiscovered: { value: "ingest.discovered", tier: 2, consumers: ["replay", "coverage"], question: "what document structure (subject/chapters/topics) was detected?", emitter: "ingest.orchestrator" },
  ingestExtracted: { value: "ingest.extracted", tier: 2, consumers: ["replay", "quality"], question: "how many raw proposals did extraction yield per chunk?", emitter: "ingest.orchestrator" },
  ingestValidated: { value: "ingest.validated", tier: 2, consumers: ["replay", "quality"], question: "how many proposals passed/were rejected by the validators?", emitter: "ingest.orchestrator" },
  ingestEnqueued: { value: "ingest.enqueued", tier: 2, consumers: ["replay", "review:queue", "coverage"], question: "how many MACHINE_PROPOSED objects landed for review?", emitter: "ingest.orchestrator" },

  // ── none-yet — declared, wired in a later phase (must carry activatesIn) ──
  shadowPlan: { value: "shadow.plan", tier: 3, consumers: ["evaluation"], question: "shadow-planner comparison", emitter: "none-yet", activatesIn: "Phase 2 — shadow planning" },
  fillBudgetExhausted: { value: "fill.budget.exhausted", tier: 2, consumers: ["quality"], question: "did the fill ladder run out of budget?", emitter: "none-yet", activatesIn: "Stage B+ — budget tracking" },
  slotBackfilled: { value: "slot.backfilled", tier: 2, consumers: ["quality"], question: "was a slot backfilled?", emitter: "none-yet", activatesIn: "legacy — retired path" },
  slotCoerced: { value: "slot.coerced", tier: 2, consumers: ["quality"], question: "which shape was repaired on coerce?", emitter: "none-yet", activatesIn: "Stage B — coerce telemetry" },
  blockEmitted: { value: "block.emitted", tier: 3, consumers: ["ops"], question: "a block was emitted", emitter: "none-yet", activatesIn: "deferred" },
  blockFallback: { value: "block.fallback", tier: 2, consumers: ["quality"], question: "a block fell back to minimal", emitter: "none-yet", activatesIn: "Stage B — superseded by slot.failed" },
  providerRatelimited: { value: "provider.ratelimited", tier: 2, consumers: ["health:provider-chain"], question: "was a provider rate-limited?", emitter: "none-yet", activatesIn: "Stage C — provider health" },
} as const satisfies Record<string, EventDecl>;

export type TaxonomyKey = keyof typeof TAXONOMY;

/** value → tier, for emit()'s default tier. Built from TAXONOMY (no EVENTS import → no cycle). */
const TIER_BY_VALUE: Record<string, Tier> = Object.fromEntries(
  Object.values(TAXONOMY).map((d) => [d.value, d.tier]),
);

export function tierFor(type: string): Tier {
  return TIER_BY_VALUE[type] ?? 2; // unknown type → tier 2 (retryable, not best-effort)
}
