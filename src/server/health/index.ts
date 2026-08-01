// Importing this module registers every provider (side effect) — no switch anywhere.
import "@/server/health/providers";
import "@/server/health/knowledgeProviders"; // §28 — knowledge platform health, probes live

export { checkAll, aggregate, providers, type ComponentReport } from "@/server/health/registry";
export type { HealthStatus, HealthReport, HealthProvider } from "@/server/health/types";
