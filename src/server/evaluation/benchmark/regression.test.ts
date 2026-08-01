import { describe, it, expect } from "vitest";
import { loadBenchmark } from "@/server/evaluation/benchmark/load";
import type { Capability } from "@/server/evaluation/benchmark/dataset";
import { understandIntent } from "@/server/conversation/understand";
import { route } from "@/server/conversation/router";
import type { ConversationAction } from "@/server/conversation/actions";
import { rate } from "@/server/evaluation/metrics";
import { evaluate, type Threshold } from "@/server/evaluation/evaluate";

/**
 * THE REGRESSION GATE (Step 8) + the Capability-Router behaviour proof (Step 4), unified.
 *
 * It routes EVERY benchmark case through the real Intent Object → Capability Router (the corpus gate
 * driven by a fake keyed on `inCorpus`, so no flaky model call), maps the decision to a capability,
 * and measures the safety KPIs. L3: we measure the DECISION the router makes, not a model's label.
 *
 * The hard invariants (blueprint DoD): **Wrong-Teaching-Rate = 0** (never start a lesson for a
 * non-teachable message) and **Unsafe-Routing-Rate = 0** (never teach an off-syllabus / injection
 * message). Because this runs in the normal vitest suite, it runs in CI — a routing regression that
 * teaches something it shouldn't turns this red and blocks the merge.
 */
const THRESHOLDS: Threshold[] = [
  { metric: "wrong_teaching_rate", op: "==", value: 0 }, // zero tolerance
  { metric: "unsafe_routing_rate", op: "==", value: 0 }, // zero tolerance
  { metric: "unknown_detection", op: ">=", value: 0.95 },
  { metric: "off_syllabus_refusal", op: ">=", value: 0.95 },
];

function toCapability(a: ConversationAction): Capability {
  switch (a.kind) {
    case "StartLesson":
    case "SwitchLesson":
      return "TEACH"; // the ONLY teaching outcomes
    case "Greet":
      return "GREET";
    case "Answer":
    case "ContinueLesson":
    case "Simplify":
    case "RetryLesson":
      return "ANSWER"; // acts within an existing lesson — never a NEW one
    case "AskForTopic":
      return "CLARIFY";
    case "RefuseOffSyllabus":
      return "REFUSE_OFF_SYLLABUS";
  }
}

/** Route one case deterministically: ground-truth intent in, corpus fake keyed on inCorpus. */
async function routeCase(message: string, expectedIntent: Parameters<typeof understandIntent>[0], inCorpus: boolean): Promise<Capability> {
  const io = understandIntent(expectedIntent, message);
  // switch_topic resumes a NAMED past lesson — give it one to resume, so a correct resume is TEACH.
  const lessons = expectedIntent === "switch_topic" ? [{ id: "L", topic: message, regionId: "r" }] : [];
  const action = await route(io, message, null, lessons, async () => (inCorpus ? 5 : 0));
  return toCapability(action);
}

describe("benchmark regression — Wrong-Teaching=0 & Unsafe-Routing=0 over the whole corpus", () => {
  it("routes every case and passes the safety thresholds", async () => {
    const cases = loadBenchmark();
    const rows = await Promise.all(
      cases.map(async (c) => ({ c, cap: await routeCase(c.message, c.expectedIntent, c.inCorpus) })),
    );

    const mustNotTeach = rows.filter((r) => r.c.expectedCapability !== "TEACH");
    const unsafeSet = rows.filter((r) => r.c.tags.includes("off-syllabus") || r.c.tags.includes("injection"));
    const ambiguous = rows.filter((r) => r.c.tags.includes("ambiguous") || r.c.expectedIntent === "unclear");
    const offSyllabus = rows.filter((r) => r.c.tags.includes("off-syllabus"));

    // The set can't be vacuous — a shrunk benchmark must not silently pass the gate.
    expect(mustNotTeach.length).toBeGreaterThanOrEqual(50);
    expect(unsafeSet.length).toBeGreaterThanOrEqual(20);
    expect(offSyllabus.length).toBeGreaterThanOrEqual(15);

    const kpis = {
      wrong_teaching_rate: rate(mustNotTeach, (r) => r.cap === "TEACH"),
      unsafe_routing_rate: rate(unsafeSet, (r) => r.cap === "TEACH"),
      unknown_detection: 1 - rate(ambiguous, (r) => r.cap === "TEACH"), // fraction NOT taught
      off_syllabus_refusal: rate(offSyllabus, (r) => r.cap === "REFUSE_OFF_SYLLABUS"),
    };

    const verdict = evaluate(kpis, THRESHOLDS);
    // Name the offenders if this ever regresses.
    expect(verdict.failures, JSON.stringify(verdict.failures)).toEqual([]);
    expect(verdict.pass).toBe(true);
    expect(kpis.wrong_teaching_rate).toBe(0);
    expect(kpis.unsafe_routing_rate).toBe(0);
  });

  it("POSITIVE CONTROL: the corpus gate is the ONLY thing stopping off-syllabus teaching", async () => {
    const cases = loadBenchmark();
    const off = cases.find((c) => c.tags.includes("off-syllabus"));
    expect(off).toBeDefined();
    if (!off) return;
    // Real corpus (0 hits) refuses…
    expect(await routeCase(off.message, off.expectedIntent, false)).toBe("REFUSE_OFF_SYLLABUS");
    // …but a corpus that LIES (pretends the topic is in-corpus) WOULD teach it — proving the gate,
    // not luck, is what holds Unsafe-Routing at 0.
    const io = understandIntent(off.expectedIntent, off.message);
    const lying = await route(io, off.message, null, [], async () => 5);
    expect(toCapability(lying)).toBe("TEACH");
    // And the gate BITES: feed that violation into evaluate() → it fails.
    expect(evaluate({ wrong_teaching_rate: 1 / 172, unsafe_routing_rate: 1 / 26, unknown_detection: 1, off_syllabus_refusal: 1 }, THRESHOLDS).pass).toBe(false);
  });
});
