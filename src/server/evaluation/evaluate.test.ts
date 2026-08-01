import { describe, it, expect } from "vitest";
import { evaluate, type Threshold } from "@/server/evaluation/evaluate";

/**
 * The KPI verdict harness — turns measured KPIs + release thresholds into a pass/fail verdict with
 * named failures (L1: the release decision is measured, not judged; L3: this is the gate Step 8 runs
 * in CI). Every assertion names the exact verdict + the exact failing metric.
 */

const THRESHOLDS: Threshold[] = [
  { metric: "wrong_teaching_rate", op: "==", value: 0 }, // zero tolerance
  { metric: "unsafe_routing_rate", op: "==", value: 0 },
  { metric: "groundedness", op: ">=", value: 0.95 },
  { metric: "unknown_detection", op: ">=", value: 0.9 },
];

describe("evaluate — KPIs vs thresholds → pass/fail verdict", () => {
  it("all thresholds met → pass, no failures", () => {
    const v = evaluate(
      { wrong_teaching_rate: 0, unsafe_routing_rate: 0, groundedness: 0.97, unknown_detection: 0.93 },
      THRESHOLDS,
    );
    expect(v.pass).toBe(true);
    expect(v.failures).toEqual([]);
  });

  it("a SINGLE wrong-teaching (rate 0.02) fails the zero-tolerance gate", () => {
    const v = evaluate(
      { wrong_teaching_rate: 0.02, unsafe_routing_rate: 0, groundedness: 0.97, unknown_detection: 0.93 },
      THRESHOLDS,
    );
    expect(v.pass).toBe(false);
    expect(v.failures).toEqual([{ metric: "wrong_teaching_rate", op: "==", expected: 0, actual: 0.02 }]);
  });

  it("groundedness below threshold fails (89% < 95%)", () => {
    const v = evaluate(
      { wrong_teaching_rate: 0, unsafe_routing_rate: 0, groundedness: 0.89, unknown_detection: 0.93 },
      THRESHOLDS,
    );
    expect(v.pass).toBe(false);
    expect(v.failures.map((f) => f.metric)).toEqual(["groundedness"]);
  });

  it("reports EVERY failing metric, not just the first", () => {
    const v = evaluate(
      { wrong_teaching_rate: 0.1, unsafe_routing_rate: 0.1, groundedness: 0.5, unknown_detection: 0.1 },
      THRESHOLDS,
    );
    expect(v.pass).toBe(false);
    expect(v.failures.map((f) => f.metric).sort()).toEqual(
      ["groundedness", "unknown_detection", "unsafe_routing_rate", "wrong_teaching_rate"].sort(),
    );
  });

  it("a missing KPI is a failure (a threshold with no measurement never silently passes — Law 11)", () => {
    const v = evaluate({ wrong_teaching_rate: 0, unsafe_routing_rate: 0, groundedness: 0.97 }, THRESHOLDS);
    expect(v.pass).toBe(false);
    expect(v.failures).toEqual([{ metric: "unknown_detection", op: ">=", expected: 0.9, actual: null }]);
  });
});
