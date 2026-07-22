/**
 * Health as a first-class subsystem. Real components get real checks; unbuilt engines
 * register NOT_INSTALLED through the SAME interface — a green dashboard that lies is
 * worse than none. Detectors predict off a rolling baseline drawn from evidence and
 * report INSUFFICIENT_DATA until the baseline is real (invariant 7).
 */
export type HealthStatus =
  | "UP"
  | "DEGRADED"
  | "DOWN"
  | "UNSAFE" // evidence can't be trusted (dropped Tier-1 / Outbox unavailable) — stop, don't teach against unrecordable history
  | "NOT_INSTALLED" // a real, declared engine that hasn't been built yet
  | "INSUFFICIENT_DATA"; // a predictor without enough baseline to judge

export interface HealthReport {
  status: HealthStatus;
  latencyMs?: number;
  errorRate?: number;
  lastSuccessAt?: number | null;
  since?: number | null;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface HealthProvider {
  name: string;
  kind: "infrastructure" | "engine";
  dependencies: string[];
  check(opts?: { deep?: boolean }): Promise<HealthReport>;
}
