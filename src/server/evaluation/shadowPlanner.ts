/**
 * EVALUATION WORLD — measures/improves the Teaching Engine. Production emits events;
 * Evaluation subscribes. **Imported by NOTHING in production** (the architecture test
 * enforces this) and feature-flagged OFF. Never teaches, never mutates lesson state,
 * never slows production.
 *
 * Shadow planning lives here now (removed from the production pipeline). When enabled,
 * it would run a shadow *planner advisor* over the same input and store the planning
 * diff (proposed vs the rules' outline, tokens, timing) as telemetry for improving
 * future planners. It is inert until a planner advisor is wired — deliberately: an
 * unused abstraction is not a feature. This module imports no AI SDK (that would put
 * it under `advisors/`); it only records diffs handed to it.
 */
export const SHADOW_ENABLED = process.env.SHADOW_PLANNING === "1";

export interface ShadowDiff {
  topic: string;
  proposed: string[]; // a planner advisor's outline (types), when wired
  chosen: string[]; // what repairOutline actually chose
  ms: number;
  tokens: number;
}

/** Store a planning diff — no-op unless the flag is on. Never throws. */
export async function recordShadowPlan(_diff: ShadowDiff): Promise<void> {
  if (!SHADOW_ENABLED) return;
  // Wiring point: persist to the Event table (Evaluation may import prisma; it is not
  // production). Left unwired until a planner advisor exists to produce a real diff.
}
