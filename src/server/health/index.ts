// Importing this module registers every provider (side effect) — no switch anywhere.
import "@/server/health/providers";

export { checkAll, aggregate, providers, type ComponentReport } from "@/server/health/registry";
export type { HealthStatus, HealthReport, HealthProvider } from "@/server/health/types";
