import type { HealthProvider, HealthReport, HealthStatus } from "@/server/health/types";

/** Self-registration — providers call register() at import; no switch, no per-engine edit. */
const REGISTRY = new Map<string, HealthProvider>();

export function register(p: HealthProvider): void {
  REGISTRY.set(p.name, p);
}
export function providers(): HealthProvider[] {
  return [...REGISTRY.values()];
}

export interface ComponentReport extends HealthReport {
  name: string;
  kind: HealthProvider["kind"];
  dependencies: string[];
}

export async function checkAll(opts: { deep?: boolean } = {}): Promise<ComponentReport[]> {
  return Promise.all(
    providers().map(async (p): Promise<ComponentReport> => {
      try {
        const r = await p.check(opts);
        return { name: p.name, kind: p.kind, dependencies: p.dependencies, ...r };
      } catch (e) {
        return { name: p.name, kind: p.kind, dependencies: p.dependencies, status: "DOWN", reason: e instanceof Error ? e.message : "check threw" };
      }
    }),
  );
}

/**
 * The aggregate. UNSAFE dominates everything (evidence untrustworthy → refuse). A real
 * component DOWN → DEGRADED at minimum. `extra` lets the route inject a live signal it
 * alone can see (e.g. an empty provider chain) without src/server/health importing advisors/.
 */
export function aggregate(reports: ComponentReport[], extra?: { emptyProviderChain?: boolean }): { status: HealthStatus; reason: string } {
  if (reports.some((r) => r.status === "UNSAFE")) return { status: "UNSAFE", reason: "Tier-1 evidence dropped or Outbox unavailable — refusing to trust history" };
  if (reports.some((r) => r.kind === "infrastructure" && r.status === "DOWN")) return { status: "DOWN", reason: "a core component is down" };
  if (extra?.emptyProviderChain) return { status: "DEGRADED", reason: "no model provider configured" };
  if (reports.some((r) => r.status === "DEGRADED")) return { status: "DEGRADED", reason: "a component is degraded" };
  return { status: "UP", reason: "all real components healthy" };
}
