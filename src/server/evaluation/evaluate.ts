/**
 * The KPI verdict harness — the ONE place a set of measured KPIs becomes a pass/fail release decision
 * (L1: the decision is measured; L3: this is the gate the CI `evals` job runs). Owned by the Evaluation
 * Engine. A threshold whose KPI is MISSING is a FAILURE (`actual: null`), never a silent pass (Law 11).
 */

export type Op = ">=" | "<=" | "==";

export interface Threshold {
  metric: string;
  op: Op;
  value: number;
}

export interface Failure {
  metric: string;
  op: Op;
  expected: number;
  actual: number | null; // null = the KPI was never measured
}

export interface Verdict {
  pass: boolean;
  failures: Failure[];
}

function holds(actual: number, op: Op, expected: number): boolean {
  if (op === ">=") return actual >= expected;
  if (op === "<=") return actual <= expected;
  return actual === expected;
}

/** Compare measured `kpis` against `thresholds`; report EVERY failing metric (not just the first). */
export function evaluate(kpis: Record<string, number>, thresholds: Threshold[]): Verdict {
  const failures: Failure[] = [];
  for (const t of thresholds) {
    const actual = kpis[t.metric];
    if (actual === undefined) {
      failures.push({ metric: t.metric, op: t.op, expected: t.value, actual: null }); // Law 11: no silent pass
      continue;
    }
    if (!holds(actual, t.op, t.value)) {
      failures.push({ metric: t.metric, op: t.op, expected: t.value, actual });
    }
  }
  return { pass: failures.length === 0, failures };
}
