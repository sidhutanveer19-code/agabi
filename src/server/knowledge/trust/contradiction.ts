import type { StatementForm } from "@/server/knowledge/types";

/**
 * Contradiction detection, per statement form (§14.4). A new statement that conflicts with a
 * higher-trust statement in an overlapping context CANNOT promote above AUTO_VALIDATED (§14.3)
 * — the graph defends itself, and does so BETTER as it grows. Forms not listed here are
 * EXPLICITLY UNDETECTABLE (`detectable: false`) rather than silently non-conflicting: an
 * undetected conflict must never look like an absence of conflict.
 *
 * Overlap: two statements overlap when they share a context id (contexts are canonical, so a
 * shared id is a genuine shared context, §14.2). Fuller specificity-based overlap is a later
 * refinement; same-context is the sound, conservative condition.
 */
export interface ContradictionInput {
  form: StatementForm;
  contextId: string;
  subjectId?: string | null;
  predicate?: string | null;
  objectId?: string | null;
  objectLit?: string | null;
  structure: Record<string, unknown>;
}

export interface ContradictionResult {
  conflict: boolean;
  detectable: boolean; // false = this form has no defined conflict rule (§14.4)
  form: StatementForm;
  reason?: string;
}

const obj = (s: ContradictionInput) => s.objectId ?? s.objectLit ?? null;
const str = (s: ContradictionInput, k: string) => s.structure?.[k];

export function contradicts(a: ContradictionInput, b: ContradictionInput): ContradictionResult {
  if (a.form !== b.form) return { conflict: false, detectable: true, form: a.form, reason: "DIFFERENT_FORMS" };
  if (a.contextId !== b.contextId) return { conflict: false, detectable: true, form: a.form, reason: "NO_CONTEXT_OVERLAP" };

  switch (a.form) {
    case "SPO":
      // same subject + predicate, different object
      return result(a.form, a.subjectId === b.subjectId && a.predicate === b.predicate && obj(a) !== obj(b), "SAME_SPO_DIFFERENT_OBJECT");
    case "DEFINITIONAL":
      // same definiendum, different definiens — ALWAYS a conflict
      return result(a.form, str(a, "definiendum") === str(b, "definiendum") && str(a, "definiens") !== str(b, "definiens"), "SAME_TERM_DIFFERENT_DEFINITION");
    case "COMPARATIVE":
      // same pair + dimension, opposite direction
      return result(a.form, str(a, "pair") === str(b, "pair") && str(a, "dimension") === str(b, "dimension") && str(a, "direction") !== str(b, "direction"), "OPPOSITE_COMPARISON");
    case "CAUSAL":
      // same cause + effect, opposite sign
      return result(a.form, str(a, "cause") === str(b, "cause") && str(a, "effect") === str(b, "effect") && str(a, "sign") !== str(b, "sign"), "OPPOSITE_CAUSAL_SIGN");
    case "CONDITIONAL":
      // same antecedent, contradictory consequents
      return result(a.form, str(a, "antecedent") === str(b, "antecedent") && str(a, "consequent") !== str(b, "consequent"), "SAME_ANTECEDENT_DIFFERENT_CONSEQUENT");
    case "PROBABILISTIC": {
      // non-overlapping confidence intervals on the same quantity
      if (str(a, "quantity") !== str(b, "quantity")) return result(a.form, false);
      const ia = interval(str(a, "interval"));
      const ib = interval(str(b, "interval"));
      if (!ia || !ib) return { conflict: false, detectable: false, form: a.form, reason: "NO_INTERVAL" };
      const overlap = ia[0] <= ib[1] && ib[0] <= ia[1];
      return result(a.form, !overlap, "DISJOINT_INTERVALS");
    }
    case "QUANTIFIED":
      // universal vs existential counterexample over the same domain
      return result(
        a.form,
        str(a, "domain") === str(b, "domain") && str(a, "quantifier") !== str(b, "quantifier") && str(a, "claim") !== str(b, "claim"),
        "UNIVERSAL_VS_COUNTEREXAMPLE",
      );
    default:
      return { conflict: false, detectable: false, form: a.form, reason: "FORM_UNDETECTABLE" };
  }
}

/** Does `candidate` conflict with ANY of the higher-trust statements? Blocks promotion (§14.3). */
export function anyContradiction(candidate: ContradictionInput, higherTrust: ContradictionInput[]): boolean {
  return higherTrust.some((s) => contradicts(candidate, s).conflict);
}

function result(form: StatementForm, conflict: boolean, reason?: string): ContradictionResult {
  return { conflict, detectable: true, form, reason: conflict ? reason : undefined };
}

function interval(v: unknown): [number, number] | null {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") return [v[0], v[1]];
  return null;
}
