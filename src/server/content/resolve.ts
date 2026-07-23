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
import { PROMPT_VERSION } from "@/server/advisors/knowledge/prompts";
import type { Chunk } from "@/server/ingest/chunk";

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
export class Resolver {
  private readonly nameToId = new Map<string, string>();
  readonly counts = { concepts: 0, statements: 0, provenance: 0, edges: 0, assets: 0, items: 0 };

  constructor(
    private readonly store: KnowledgeStore,
    private readonly sourceId: string,
    private readonly modelId: string,
    private readonly scope: Scope = "PUBLIC",
  ) {}

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

  /** Persist one validated statement + its provenance (the quote is verification-only, §27.1). */
  async persistStatement(raw: RawStatement, chunk: Chunk): Promise<string> {
    const ctx = await this.store.putContext(raw.contextDimensions ?? {});
    let structure: Record<string, unknown> = { ...raw.structure };
    if (raw.form === "SPO") {
      const subjectId = raw.subject ? await this.resolveConcept(raw.subject) : undefined;
      const objectId = raw.object ? await this.resolveConcept(raw.object) : undefined;
      structure = {
        ...(subjectId ? { subjectId } : {}),
        predicate: raw.predicate ?? "",
        ...(objectId ? { objectId } : raw.objectLit ? { objectLit: raw.objectLit } : {}),
      };
    }
    const stmt = buildStatement({ kind: raw.kind, form: raw.form, structure, text: raw.text, contextId: ctx.id, scope: this.scope });
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
      const edge: DependencyEdge = { fromId, toId, strength: 1, contextId: null, version: 1, supersedes: null };
      await this.store.putDependencyEdge(edge);
    } else if (raw.classification === "PART_OF") {
      const edge: CompositionEdge = { partId: fromId, wholeId: toId, ordinal: null, version: 1 };
      await this.store.putCompositionEdge(edge);
    } else {
      const edge: ReinforcementEdge = { fromId, toId, type: raw.type ?? "REINFORCES", strength: 1, earned: false, contextId: null, version: 1 };
      await this.store.putReinforcementEdge(edge);
    }
    this.counts.edges++;
  }

  /** Persist a teaching asset (MACHINE_PROPOSED). Its concept is resolved/created first. */
  async persistAsset(raw: RawAsset, chunk: Chunk): Promise<void> {
    const conceptId = await this.resolveConcept(raw.conceptName);
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
