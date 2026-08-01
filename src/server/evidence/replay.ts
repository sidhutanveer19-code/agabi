import { EVENTS } from "@/server/events";

/**
 * Pure reducer: Event rows → LessonSnapshot. No DB, no network, no clock (invariant
 * 5). Orders by `seq` ALONE (createdAt collides inside a createMany). If this can't
 * rebuild the lesson, the evidence is incomplete and that is a bug in the emitter —
 * which is exactly what the Stage-A reconstruction proof asserts.
 */
export interface ReplayEvent {
  type: string;
  seq: bigint | number | string; // bigserial; may arrive as string over JSON
  payload: unknown;
  lessonId?: string | null;
  causedByEventId?: string | null;
}

export interface SlotTrace {
  index: number;
  state: "READY" | "FAILED";
  provider?: string;
  rung?: number;
  ms?: number;
}

export interface LessonSnapshot {
  lessonId: string | null;
  requestText: string | null;
  routing: string | null; // the action the backend chose
  topic: string | null;
  states: string[]; // ordered transition targets
  finalState: string | null;
  cursor: number; // last recorded cursor
  slots: SlotTrace[];
  providers: string[]; // distinct, in first-seen order
  outcome: string | null; // COMPLETE | PARTIAL | FAILED | CANCELLED
  errors: string[];
}

const asBig = (s: bigint | number | string): bigint => (typeof s === "bigint" ? s : BigInt(s));
const rec = (p: unknown): Record<string, unknown> => (p && typeof p === "object" ? (p as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function replay(events: ReplayEvent[]): LessonSnapshot {
  const ordered = [...events].sort((a, b) => {
    const x = asBig(a.seq), y = asBig(b.seq);
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const snap: LessonSnapshot = {
    lessonId: null, requestText: null, routing: null, topic: null,
    states: [], finalState: null, cursor: 0, slots: [], providers: [], outcome: null, errors: [],
  };
  const seenProvider = new Set<string>();

  for (const e of ordered) {
    const p = rec(e.payload);
    if (e.lessonId && !snap.lessonId) snap.lessonId = e.lessonId;

    switch (e.type) {
      case EVENTS.requestReceived:
        snap.requestText = str(p.text) ?? snap.requestText;
        break;
      case EVENTS.commandSent: // routing decision
        snap.routing = str(p.action) ?? snap.routing;
        break;
      case EVENTS.lessonStarted:
        // lesson.started is self-sufficient for a lessonId-scoped replay: it carries the
        // topic AND (redundantly) the request text + routing, which the turn-level
        // request.received/command.sent emit with lessonId=null (before the id exists).
        snap.topic = str(p.topic) ?? snap.topic;
        snap.requestText = snap.requestText ?? str(p.requestText) ?? null;
        snap.routing = snap.routing ?? str(p.routing) ?? null;
        break;
      case EVENTS.lessonState: {
        const to = str(p.to);
        if (to) { snap.states.push(to); snap.finalState = to; }
        break;
      }
      case EVENTS.lessonCursor:
        snap.cursor = num(p.cursor) ?? snap.cursor;
        break;
      case EVENTS.slotFilled: {
        const index = num(p.slot);
        if (index !== undefined) {
          const provider = str(p.provider);
          if (provider && !seenProvider.has(provider)) { seenProvider.add(provider); snap.providers.push(provider); }
          snap.slots.push({ index, state: "READY", provider, rung: num(p.rung), ms: num(p.ms) });
        }
        break;
      }
      case EVENTS.slotFailed: {
        const index = num(p.slot);
        if (index !== undefined) snap.slots.push({ index, state: "FAILED", rung: num(p.rung) });
        break;
      }
      case EVENTS.lessonFinished:
        snap.outcome = str(p.outcome) ?? "COMPLETE";
        break;
      case EVENTS.lessonCancelled:
        snap.outcome = "CANCELLED";
        break;
      case EVENTS.error: {
        const m = str(p.message);
        if (m) snap.errors.push(m);
        break;
      }
    }
  }
  return snap;
}
