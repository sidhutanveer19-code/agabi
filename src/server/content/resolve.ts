import { z } from "zod";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type {
  Scope,
  DependencyEdge,
  CompositionEdge,
  ReinforcementEdge,
  TeachingAsset,
  AssessmentItem,
} from "@/server/knowledge/types";
import type { RawStatement, RawDependency, RawAsset } from "@/server/knowledge/extraction/types";
import type { RawItemSchema } from "@/server/knowledge/extraction/schemas";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
import { mintId, slugify } from "@/server/knowledge/ids";
import { POLICIES } from "@/server/knowledge/trust/policy";
import { PROMPT_VERSION } from "@/server/advisors/knowledge/prompts";
import type { Chunk } from "@/server/ingest/chunk";
import type { Omission } from "@/server/content/omissions";
import { validatorsPass, type ValidationResult } from "@/server/knowledge/validators";

type RawItem = z.infer<typeof RawItemSchema>;

/**
 * The resolve-and-persist bridge (W1). Extraction proposes with *names* + a raw
 * `contextDimensions` record; the graph stores *resolved ids* + a `contextId`. This is the
 * one place that closes that gap — the missing wiring the audit found between validate and
 * the store. Every write is append-only, everything lands at `MACHINE_PROPOSED` / concept
 * `DRAFT` (trust is assigned later by human review, never here — ADR-2, §26.2).
 *
 * A `Resolver` is created per ingest run: it caches name→conceptId so the same entity name
 * within a run resolves to one concept, and it never touches trust.
 */
/**
 * The subject/object a proposal is ABOUT (A-5). Local models put the name at the top level for SPO
 * and inside `structure` for the other forms — both are read, so no form loses its concept link.
 */
function nameIn(structure: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = structure?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function subjectNameOf(raw: RawStatement): string | undefined {
  return (raw.subject?.trim() || undefined) ?? nameIn(raw.structure, "subject");
}
function objectNameOf(raw: RawStatement): string | undefined {
  return (raw.object?.trim() || undefined) ?? nameIn(raw.structure, "object");
}

export class Resolver {
  private readonly nameToId = new Map<string, string>();
  readonly counts = { concepts: 0, statements: 0, provenance: 0, edges: 0, assets: 0, items: 0, duplicatesSkipped: 0 };
  readonly omissions: Omission[] = []; // R1 — every skip this resolver made, with its reason

  constructor(
    private readonly store: KnowledgeStore,
    private readonly sourceId: string,
    private readonly modelId: string,
    private readonly scope: Scope = "PUBLIC",
  ) {}

  /** R1: a duplicate is a skip. Count it AND say what it collapsed into and why. */
  private skipDuplicate(reason: string, data: Record<string, unknown>): void {
    this.counts.duplicatesSkipped++;
    this.omissions.push({ stage: "persist", kind: "duplicate-skipped", reason, data });
  }

  /** Resolve an entity name to a concept id, creating a DRAFT concept the first time a new
   *  name is seen. Existing concepts are reused by slug; ambiguous/none → a fresh DRAFT. */
  async resolveConcept(name: string): Promise<string> {
    const key = name.trim().toLowerCase();
    const cached = this.nameToId.get(key);
    if (cached) return cached;

    const existing = await this.store.resolveSlug(slugify(name), this.scope);
    if (existing.kind === "concept") {
      this.nameToId.set(key, existing.conceptId);
      return existing.conceptId;
    }
    const concept = buildConcept({ name, scope: this.scope }); // status DRAFT
    await this.store.putConcept(concept);
    this.counts.concepts++;
    this.nameToId.set(key, concept.id);
    return concept.id;
  }

  /**
   * Persist one validated statement + its provenance (the quote is verification-only, §27.1).
   * IDEMPOTENT: re-ingesting the same source is a no-op for an already-present SPO statement (same
   * subject/predicate/object/text). Uses existing scoped reads — no new schema, A-1 ids preserved.
   * Returns the (existing or new) statement id.
   */
  async persistStatement(raw: RawStatement, chunk: Chunk, validation: ValidationResult[] = []): Promise<string> {
    const subjectName = subjectNameOf(raw);
    const objectName = objectNameOf(raw);
    const subjectId = subjectName ? await this.resolveConcept(subjectName) : undefined;
    const objectId = objectName ? await this.resolveConcept(objectName) : undefined;

    if (!subjectId) {
      // R1: an unattached statement is invisible to every concept read. Record it, never drop it.
      this.omissions.push({
        stage: "resolve",
        kind: "subject-unresolved",
        chunkId: chunk.id,
        reason: `no subject name in raw.subject or structure.subject (form=${raw.form}) — statement is persisted but reachable from no concept`,
        data: { form: raw.form, text: raw.text.slice(0, 160), structureKeys: Object.keys(raw.structure ?? {}) },
      });
    }

    // Idempotency (A-5): dedup on the aboutness subject for EVERY form, not SPO alone.
    if (subjectId) {
      const existing = await this.store.statementsForSubject(subjectId, this.scope, POLICIES.RND);
      const dup = existing.find((s) =>
        raw.form === "SPO"
          ? (s.predicate ?? "") === (raw.predicate ?? "") && s.text === raw.text && (objectId ? s.objectId === objectId : (s.objectLit ?? null) === (raw.objectLit ?? null))
          : s.form === raw.form && s.text === raw.text,
      );
      if (dup) {
        this.counts.duplicatesSkipped++;
        this.omissions.push({ stage: "persist", kind: "duplicate-skipped", chunkId: chunk.id, targetId: dup.id, reason: "identical statement already present for this subject", data: { form: raw.form, text: raw.text.slice(0, 160) } });
        return dup.id;
      }
    }

    const ctx = await this.store.putContext(raw.contextDimensions ?? {});
    const structure: Record<string, unknown> =
      raw.form === "SPO"
        ? { ...(subjectId ? { subjectId } : {}), predicate: raw.predicate ?? "", ...(objectId ? { objectId } : raw.objectLit ? { objectLit: raw.objectLit } : {}) }
        : { ...raw.structure, ...(subjectId ? { subjectId } : {}), ...(objectId ? { objectId } : {}) };
    // §14 / §26.2 — the machine ceiling. A proposal that passed EVERY applicable gate is
    // AUTO_VALIDATED by definition; one that did not stays MACHINE_PROPOSED. Neither is a promotion:
    // `requiresHumanReview` still gates everything above, and no learner policy has a floor this low.
    // Without this the ladder's own AUTO_VALIDATED precondition could never be met, so no statement
    // was ever eligible for human promotion — the M3 gate was unreachable.
    const clean = validation.length > 0 && validatorsPass(validation);
    const stmt = buildStatement({
      kind: raw.kind, form: raw.form, structure, text: raw.text, contextId: ctx.id, scope: this.scope,
      ...(subjectId ? { subjectId } : {}),
      ...(clean ? { trustLevel: "AUTO_VALIDATED" as const, validationMethods: validation.map((v) => v.validator), independentSourceCount: 1 } : {}),
    });
    await this.store.putStatement(stmt);
    this.counts.statements++;
    await this.store.putProvenance({
      statementId: stmt.id,
      sourceId: this.sourceId,
      chunkId: chunk.id,
      locator: chunk.locator,
      quote: raw.quote,
      extractorVersion: PROMPT_VERSION,
      promptVersion: PROMPT_VERSION,
      modelId: this.modelId,
      extractedAt: new Date(),
    });
    this.counts.provenance++;
    return stmt.id;
  }

  /** Persist a validated edge into the correct graph. Caller has already run the acyclicity
   *  gates (V7/V8/V10); a rejected edge is never passed here. */
  async persistDependency(raw: RawDependency): Promise<void> {
    const fromId = await this.resolveConcept(raw.fromName);
    const toId = await this.resolveConcept(raw.toName);
    if (raw.classification === "REQUIRES") {
      if ((await this.store.dependencyEdges()).some((e) => e.fromId === fromId && e.toId === toId)) { this.skipDuplicate("REQUIRES edge already present", { fromId, toId }); return; }
      const edge: DependencyEdge = { fromId, toId, strength: 1, contextId: null, version: 1, supersedes: null };
      await this.store.putDependencyEdge(edge);
    } else if (raw.classification === "PART_OF") {
      if ((await this.store.compositionEdges()).some((e) => e.partId === fromId && e.wholeId === toId)) { this.skipDuplicate("PART_OF edge already present", { fromId, toId }); return; }
      const edge: CompositionEdge = { partId: fromId, wholeId: toId, ordinal: null, version: 1 };
      await this.store.putCompositionEdge(edge);
    } else {
      if ((await this.store.reinforcementEdges()).some((e) => e.fromId === fromId && e.toId === toId)) { this.skipDuplicate("REINFORCEMENT edge already present", { fromId, toId }); return; }
      const edge: ReinforcementEdge = { fromId, toId, type: raw.type ?? "REINFORCES", strength: 1, earned: false, contextId: null, version: 1 };
      await this.store.putReinforcementEdge(edge);
    }
    this.counts.edges++;
  }

  /** Persist a teaching asset (MACHINE_PROPOSED). Its concept is resolved/created first. */
  async persistAsset(raw: RawAsset, chunk: Chunk): Promise<void> {
    const conceptId = await this.resolveConcept(raw.conceptName);
    const key = JSON.stringify(raw.payload);
    if ((await this.store.assetsForConcept(conceptId, this.scope, POLICIES.RND)).some((a) => a.kind === raw.kind && JSON.stringify(a.payload) === key)) {
      this.skipDuplicate("identical teaching asset already present for this concept", { conceptId, kind: raw.kind });
      return;
    }
    const ctx = await this.store.putContext({});
    const asset: TeachingAsset = {
      id: mintId(),
      kind: raw.kind,
      conceptId,
      statementId: null,
      payload: raw.payload,
      contextId: ctx.id,
      trustLevel: "MACHINE_PROPOSED",
      scope: this.scope,
      version: 1,
      supersedes: null,
    };
    void chunk;
    await this.store.putTeachingAsset(asset);
    this.counts.assets++;
  }

  /** Persist an assessment item + its concept link (MACHINE_PROPOSED). */
  async persistItem(raw: RawItem): Promise<void> {
    const conceptId = await this.resolveConcept(raw.conceptName);
    if ((await this.store.itemsForConcept(conceptId, this.scope, POLICIES.RND)).some((i) => i.kind === raw.kind && i.prompt === raw.prompt)) {
      this.skipDuplicate("identical assessment item already present for this concept", { conceptId, kind: raw.kind, prompt: raw.prompt.slice(0, 120) });
      return;
    }
    const ctx = await this.store.putContext({});
    const itemId = mintId();
    const item: AssessmentItem = {
      id: itemId,
      kind: raw.kind,
      prompt: raw.prompt,
      payload: raw.payload,
      contextId: ctx.id,
      scope: this.scope,
      trustLevel: "MACHINE_PROPOSED",
      version: 1,
      supersedes: null,
    };
    await this.store.putAssessmentItem(item);
    await this.store.putItemConcept({ itemId, conceptId, role: "PRIMARY", bloom: null });
    this.counts.items++;
  }
}
