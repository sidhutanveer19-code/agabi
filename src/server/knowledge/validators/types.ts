/**
 * Validation outcomes (§14). Each gate returns one of these; the runner aggregates. The
 * distinction matters: `discard` throws the proposal away, `reject` throws it away AND
 * reports why (e.g. the cycle), `flag` keeps it but routes it to human attention, `human`
 * means it can NEVER auto-promote (V9 edge classification). `securityAlert` rides on V13.
 */
export type Outcome = "pass" | "discard" | "flag" | "reject" | "human";

export interface ValidationResult {
  validator: string; // "V3", "V7", …
  outcome: Outcome;
  reason?: string;
  detail?: unknown; // e.g. the cycle path for V7, the char range for V3
  securityAlert?: boolean; // V13 cross-tenant reference
}

export const pass = (validator: string): ValidationResult => ({ validator, outcome: "pass" });
