import type { Statement, StatementForm, Scope, TrustLevel } from "@/server/knowledge/types";
import { mintId } from "@/server/knowledge/ids";

/**
 * Statement construction (§10, §14.4).
 *
 * **Amendment A-5 — `subjectId` is the ABOUTNESS index, not the SPO index.** It is populated for
 * EVERY form whenever a subject concept resolves; `predicate`/`objectId`/`objectLit` keep their
 * SPO-only denormalisation, and the other forms still carry their shape in `structure`.
 *
 * Why: `statementsForSubject()` is the only path from a concept to what is known about it (and the
 * `stmt_teachable` index is on `(subjectId, contextId)`). Under the original SPO-only rule a live
 * run produced 40 statements of which 39 — every DEFINITIONAL, CAUSAL, QUANTIFIED and COMPARATIVE
 * one — were reachable from no concept at all, making the graph unteachable and pinning
 * `coverageRate` at 1/358. The column was already nullable and already indexed, so no migration.
 *
 * A statement is built at MACHINE_PROPOSED: trust is assigned by the platform through review, never
 * claimed at construction (ADR-2).
 */

export interface StatementInput {
  kind: string; // FACT|PROCEDURE|PRINCIPLE|RULE|… (registry)
  form: StatementForm;
  structure: Record<string, unknown>;
  text: string; // WRITTEN, never copied from source (§27.1)
  payload?: Record<string, unknown>;
  contextId: string;
  scope?: Scope;
  subjectId?: string; // A-5: aboutness — the concept this statement is about, for ANY form
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
 * Build a statement. `predicate`/`objectId`/`objectLit` are denormalised for form=SPO only;
 * `subjectId` is the aboutness index and is set for any form (A-5) — from the explicit input when
 * given, else from an SPO structure. V15 (subject ≠ object) is a validation gate (M2) not enforced
 * here; construction stays mechanical.
 */
export function buildStatement(input: StatementInput): Statement {
  const spo = input.form === "SPO" && isSpo(input.structure) ? input.structure : null;
  return {
    id: mintId(),
    kind: input.kind,
    form: input.form,
    structure: input.structure,
    subjectId: input.subjectId ?? (spo ? spo.subjectId : null),
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
    disputed: false,
    disputeReason: null,
    disputedAt: null,
    priorTrustLevel: null,
  };
}
