import type { Statement, StatementForm, Scope, TrustLevel } from "@/server/knowledge/types";
import { mintId } from "@/server/knowledge/ids";

/**
 * Statement construction (§10, §14.4). Seven forms; SPO is ONE case that gets a
 * denormalised index (`subjectId/predicate/objectId/objectLit`) so subject lookups
 * hit one index — the other forms carry everything in `structure` and leave the SPO
 * columns null. A statement is built at MACHINE_PROPOSED: trust is assigned by the
 * platform through review, never claimed at construction (ADR-2).
 */

export interface StatementInput {
  kind: string; // FACT|PROCEDURE|PRINCIPLE|RULE|… (registry)
  form: StatementForm;
  structure: Record<string, unknown>;
  text: string; // WRITTEN, never copied from source (§27.1)
  payload?: Record<string, unknown>;
  contextId: string;
  scope?: Scope;
}

/** SPO structure: { subjectId, predicate, objectId? , objectLit? }. */
interface SpoStructure {
  subjectId: string;
  predicate: string;
  objectId?: string;
  objectLit?: string;
}

function isSpo(structure: Record<string, unknown>): structure is SpoStructure & Record<string, unknown> {
  return typeof structure.subjectId === "string" && typeof structure.predicate === "string";
}

/**
 * Build a statement, denormalising SPO fields for form=SPO only. V15 (subject ≠ object)
 * is a validation gate (M2) not enforced here; construction stays mechanical.
 */
export function buildStatement(input: StatementInput): Statement {
  const spo = input.form === "SPO" && isSpo(input.structure) ? input.structure : null;
  return {
    id: mintId(),
    kind: input.kind,
    form: input.form,
    structure: input.structure,
    subjectId: spo ? spo.subjectId : null,
    predicate: spo ? spo.predicate : null,
    objectId: spo && typeof spo.objectId === "string" ? spo.objectId : null,
    objectLit: spo && typeof spo.objectLit === "string" ? spo.objectLit : null,
    text: input.text,
    payload: input.payload ?? {},
    contextId: input.contextId,
    scope: input.scope ?? "PUBLIC",
    trustLevel: "MACHINE_PROPOSED" as TrustLevel,
    validationMethods: [],
    corroborationCount: 0,
    independentSourceCount: 0,
    derivedFrom: [],
    authority: null,
    evidenceLevel: null,
    version: 1,
    supersedes: null,
    createdAt: new Date(),
  };
}
