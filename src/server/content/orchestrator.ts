import { z } from "zod";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { Scope, DependencyEdge, CompositionEdge } from "@/server/knowledge/types";
import type { DimensionRegistry } from "@/server/knowledge/context/registry";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";
import type { Advice } from "@/server/advisors/advice";
import type { RawStatement, RawDependency, RawAsset } from "@/server/knowledge/extraction/types";
import type { SourceConnector, RawSource } from "@/server/ingest/connector";
import type { Chunk } from "@/server/ingest/chunk";
import type { Discover, DocumentHierarchy } from "@/server/ingest/discovery/types";
import { acquire } from "@/server/ingest/connector";
import { parseFormat, type Format } from "@/server/ingest/parse/registry";
import { cleanDoc } from "@/server/ingest/clean";
import { normaliseDoc } from "@/server/ingest/normalise";
import { chunkDoc } from "@/server/ingest/chunk";
import { docText } from "@/server/ingest/spans";
import { sha256 } from "@/server/knowledge/ids";
import { acceptEach } from "@/server/advisors/advice";
import { extractEntities } from "@/server/advisors/knowledge/extractEntities";
import { extractStatements } from "@/server/advisors/knowledge/extractStatements";
import { extractDependencies } from "@/server/advisors/knowledge/extractDependencies";
import { extractAssets } from "@/server/advisors/knowledge/extractAssets";
import { extractItems } from "@/server/advisors/knowledge/extractItems";
import { RawEntitySchema, RawStatementSchema, RawDependencySchema, RawAssetSchema, RawItemSchema } from "@/server/knowledge/extraction/schemas";
import { validateStatement, validateDependency, summarise } from "@/server/knowledge/validators";
import { Resolver } from "@/server/content/resolve";
import { discover as defaultDiscover } from "@/server/ingest/discovery/hierarchy";
import { emit, EVENTS } from "@/server/events";
import type { Omission } from "@/server/content/omissions";
import { summariseOmissions } from "@/server/content/omissions";
import type { ValidationResult } from "@/server/knowledge/validators";

/**
 * The ingest ORCHESTRATOR (W1) — the spine the audit found missing. It wires the already-built
 * stages into one append-only, resumable pass and emits one evidence event per stage, so a
 * source's journey through the factory is fully replayable:
 *
 *   acquire (licence-first) → parse → clean → normalise → chunk → discover (structure only)
 *     → extract×6 → accept (trust boundary) → validate → resolve+persist (MACHINE_PROPOSED)
 *
 * It owns NO domain logic — every step calls an existing function. Store- and invoker-agnostic
 * (memory+fake for tests, postgres+Ollama live). Terminal state is MACHINE_PROPOSED in the store:
 * the review queue's pending set. Nothing is auto-promoted (§26.2).
 */

export interface IngestOptions {
  actorId?: string; // operator running ingestion (event userId); default "system:ingest"
  scope?: Scope; // multi-tenant scope for everything produced; default "PUBLIC"
  modelId?: string; // stamped into Provenance; default "unknown"
  approveUnknown?: boolean; // approve an unknown-licence source (§24)
  registry?: DimensionRegistry; // context-dimension registry for V11; default {}
  discover?: Discover; // structural discovery (W2); defaults to the generic detector
  format?: Format; // override format detection
  collectProposals?: boolean; // keep the accepted raw statements + full text for quality scoring (W3)
}

export interface ChunkOutcome {
  chunkId: string;
  ordinal: number;
  entities: number;
  statementsProposed: number;
  statementsPersisted: number;
  rejected: number; // statementsRejected + dependenciesRejected (kept for existing callers)
  statementsRejected: number;
  dependenciesRejected: number;
  barren: boolean; // no statement survived → a coverage gap
}

/** The gates that killed a proposal, as one line. Never "rejected" with no reason (R1). */
function failedGates(results: ValidationResult[]): string {
  const bad = results.filter((r) => r.outcome !== "pass");
  return bad.map((r) => `${r.validator}:${r.outcome}${r.reason ? ` — ${r.reason}` : ""}`).join("; ") || "rejected with no failing gate (validator bug)";
}

function gateDetail(results: ValidationResult[]): { validator: string; outcome: string; reason?: string }[] {
  return results.filter((r) => r.outcome !== "pass").map((r) => ({ validator: r.validator, outcome: r.outcome, ...(r.reason ? { reason: r.reason } : {}) }));
}

export interface IngestResult {
  sourceId: string;
  source: RawSource;
  format: Format;
  chunks: Chunk[];
  hierarchy: DocumentHierarchy;
  outcomes: ChunkOutcome[];
  counts: { chunks: number; concepts: number; statements: number; edges: number; assets: number; items: number; rejected: number; statementsRejected: number; dependenciesRejected: number; barrenChunks: number; duplicatesSkipped: number; unattachedStatements: number };
  omissions: Omission[]; // R1 — EVERY omission, each with a reason. Counts above are its summary.
  stages: string[]; // event types emitted, in order (for verification)
  proposals?: RawStatement[]; // accepted raw statements (opts.collectProposals) — for quality scoring
  text?: string; // full normalised source text (opts.collectProposals) — the grounding corpus
}

function detectFormat(source: RawSource, override?: Format): Format {
  if (override) return override;
  const uri = (source.uri ?? source.title).toLowerCase();
  if (uri.endsWith(".html") || uri.endsWith(".htm")) return "html";
  if (uri.endsWith(".json")) return "json";
  if (uri.endsWith(".pdf")) return "pdf"; // routes to the pdf slot — throws E8 until a plugin registers
  return "markdown"; // default — the import format
}

type RawItem = z.infer<typeof RawItemSchema>;

/**
 * Unwrap an extraction array element-wise (A-6), recording every element the trust boundary refused.
 *
 * The old batch rule (`accept()` → null on any failure) discarded the whole array when a single
 * element was malformed. Measured cause of the yield collapse: a chunk produced eight well-formed
 * statements and one with an invented `form`, and all nine were lost. Each element is still checked
 * against the identical schema — nothing unvalidated passes — and each rejection is recorded with
 * its index, zod path and a preview of the value, so a drop is always explicable (R1).
 */
function acceptArray<T>(advice: Advice<unknown>, elementSchema: z.ZodType<T>, ctx: { extractor: string; chunkId: string; sink: Omission[] }): T[] {
  const { accepted, dropped } = acceptEach(advice as Advice<T[]>, elementSchema);
  for (const d of dropped) {
    ctx.sink.push({
      stage: "accept",
      kind: d.index < 0 ? "batch-discard" : "element-discard",
      chunkId: ctx.chunkId,
      reason: `${ctx.extractor}[${d.index}]: ${d.code} at ${d.path} — ${d.message}`,
      data: { extractor: ctx.extractor, index: d.index, zodPath: d.path, zodCode: d.code, preview: d.preview },
    });
  }
  return accepted;
}

export async function ingestSource(store: KnowledgeStore, connector: SourceConnector, ref: string, invoke: JsonInvoke, opts: IngestOptions = {}): Promise<IngestResult> {
  const actorId = opts.actorId ?? "system:ingest";
  const scope = opts.scope ?? "PUBLIC";
  const registry = opts.registry ?? {};
  const stages: string[] = [];
  const omissions: Omission[] = []; // R1 — every drop/reject/skip this run made, with its reason
  const ev = async (type: string, payload: unknown) => { stages.push(type); await emit(actorId, type, payload, "server"); };

  // ── acquire (licence before fetch) ──
  const { source, bytes } = await acquire(connector, ref, { approveUnknown: opts.approveUnknown });
  const sourceId = "src_" + sha256(source.uri ?? source.title).slice(0, 24);
  const format = detectFormat(source, opts.format);
  await ev(EVENTS.ingestAcquired, { sourceId, uri: source.uri, license: source.license, format });

  // ── parse → clean → normalise → chunk ──
  const parsed = parseFormat(bytes.toString("utf8"), format);
  await ev(EVENTS.ingestParsed, { sourceId, spans: parsed.length });
  const normalised = normaliseDoc(cleanDoc(parsed));
  await ev(EVENTS.ingestNormalised, { sourceId, spans: normalised.length });
  const chunks = chunkDoc(sourceId, normalised);
  await ev(EVENTS.ingestChunked, { sourceId, chunks: chunks.length });

  // ── persist the source + its chunks BEFORE extraction ──
  // Provenance written later carries this sourceId/chunkId; without these rows those ids point at
  // nothing, grounding cannot be re-verified after the run, and review has no passage to show.
  await store.putSource({
    id: sourceId,
    kind: source.kind,
    title: source.title,
    publisher: source.publisher,
    authority: source.authority,
    edition: null,
    publishedAt: null,
    uri: source.uri ?? null,
    checksum: sha256(bytes.toString("utf8")),
    license: source.license,
    licenseUrl: source.licenseUrl ?? null,
    ingestedAt: new Date(),
  });
  for (const c of chunks) await store.putSourceChunk({ id: c.id, sourceId: c.sourceId, locator: c.locator, text: c.text, ordinal: c.ordinal });
  await ev(EVENTS.ingestChunksPersisted, { sourceId, chunks: chunks.length });

  // ── discover (structure only, W2) — on the PARSED doc, where headings are pristine ──
  const discover = opts.discover ?? defaultDiscover;
  const hierarchy = discover(parsed, source);
  await ev(EVENTS.ingestDiscovered, { sourceId, profile: hierarchy.profile, subject: hierarchy.subject, nodes: hierarchy.nodes.length, textLength: docText(normalised).length });

  // ── extract → validate → resolve+persist, per chunk ──
  const resolver = new Resolver(store, sourceId, opts.modelId ?? "unknown", scope);
  const depEdges: DependencyEdge[] = await store.dependencyEdges();
  const compEdges: CompositionEdge[] = await store.compositionEdges();
  const outcomes: ChunkOutcome[] = [];
  const collected: RawStatement[] = [];
  let totalRejected = 0;

  for (const chunk of chunks) {
    const ac = (extractor: string) => ({ extractor, chunkId: chunk.id, sink: omissions });
    const entities = acceptArray(await extractEntities(chunk.text, invoke), RawEntitySchema, ac("entities"));
    for (const e of entities) await resolver.resolveConcept(e.name); // entity → DRAFT concept
    const names = entities.map((e) => e.name);

    const statements = acceptArray(await extractStatements(chunk.text, names, invoke), RawStatementSchema, ac("statements"));
    if (opts.collectProposals) collected.push(...statements);
    const dependencies = acceptArray(await extractDependencies(chunk.text, names, invoke), RawDependencySchema, ac("dependencies"));
    const assets = acceptArray(await extractAssets(chunk.text, names, invoke), RawAssetSchema, ac("assets"));
    const items = acceptArray(await extractItems(chunk.text, names, invoke), RawItemSchema, ac("items"));
    await ev(EVENTS.ingestExtracted, { sourceId, chunkId: chunk.id, entities: entities.length, statements: statements.length, dependencies: dependencies.length, assets: assets.length, items: items.length });

    let persisted = 0;
    let statementsRejected = 0;
    let dependenciesRejected = 0;
    for (const s of statements) {
      const results = validateStatement(s, { chunkText: chunk.text, registry });
      if (summarise(results) === "REJECTED") {
        statementsRejected++;
        omissions.push({ stage: "validate", kind: "statement-rejected", chunkId: chunk.id, reason: failedGates(results), data: { form: s.form, kind: s.kind, text: s.text.slice(0, 160), quote: s.quote.slice(0, 160), gates: gateDetail(results) } });
        continue;
      }
      await resolver.persistStatement(s, chunk);
      persisted++;
    }
    for (const d of dependencies) {
      const fromId = await resolver.resolveConcept(d.fromName);
      const toId = await resolver.resolveConcept(d.toName);
      const results = validateDependency(d, { edge: { fromId, toId }, dependency: depEdges, composition: compEdges });
      if (summarise(results) === "REJECTED") {
        dependenciesRejected++;
        omissions.push({ stage: "validate", kind: "dependency-rejected", chunkId: chunk.id, reason: failedGates(results), data: { from: d.fromName, to: d.toName, classification: d.classification, gates: gateDetail(results) } });
        continue;
      }
      await resolver.persistDependency(d);
      if (d.classification === "REQUIRES") depEdges.push({ fromId, toId, strength: 1, contextId: null, version: 1, supersedes: null });
      else if (d.classification === "PART_OF") compEdges.push({ partId: fromId, wholeId: toId, ordinal: null, version: 1 });
    }
    for (const a of assets) await resolver.persistAsset(a, chunk);
    for (const it of items) await resolver.persistItem(it);

    const rejected = statementsRejected + dependenciesRejected;
    totalRejected += rejected;
    // R1: statement and dependency rejects are SEPARATE numbers — one shared counter makes a
    // statement-only reject rate unrecoverable from the event log (it was, before this).
    await ev(EVENTS.ingestValidated, { sourceId, chunkId: chunk.id, persisted, rejected, statementsRejected, dependenciesRejected });
    if (persisted === 0) {
      omissions.push({
        stage: "validate",
        kind: "barren-chunk",
        chunkId: chunk.id,
        reason: statements.length === 0 ? "extraction proposed no statements for this chunk (see any batch-discard record for the same chunk)" : `all ${statements.length} proposed statement(s) were rejected by validation gates`,
        data: { ordinal: chunk.ordinal, chars: chunk.text.length, proposed: statements.length, entities: entities.length },
      });
    }
    outcomes.push({ chunkId: chunk.id, ordinal: chunk.ordinal, entities: entities.length, statementsProposed: statements.length, statementsPersisted: persisted, rejected, statementsRejected, dependenciesRejected, barren: persisted === 0 });
  }

  omissions.push(...resolver.omissions);
  const c = resolver.counts;
  const barrenChunks = outcomes.filter((o) => o.barren).length;
  const statementsRejected = outcomes.reduce((n, o) => n + o.statementsRejected, 0);
  const dependenciesRejected = outcomes.reduce((n, o) => n + o.dependenciesRejected, 0);
  const unattachedStatements = omissions.filter((o) => o.kind === "subject-unresolved").length;

  // R1: the omission ledger is evidence, so it is emitted as evidence — not only returned.
  await ev(EVENTS.ingestOmitted, { sourceId, total: omissions.length, byKind: summariseOmissions(omissions) });
  await ev(EVENTS.ingestEnqueued, { sourceId, concepts: c.concepts, statements: c.statements, edges: c.edges, assets: c.assets, items: c.items, barrenChunks, statementsRejected, dependenciesRejected, unattachedStatements, omissions: omissions.length });

  return {
    sourceId, source, format, chunks, hierarchy, outcomes,
    counts: { chunks: chunks.length, concepts: c.concepts, statements: c.statements, edges: c.edges, assets: c.assets, items: c.items, rejected: totalRejected, statementsRejected, dependenciesRejected, barrenChunks, duplicatesSkipped: c.duplicatesSkipped, unattachedStatements },
    omissions,
    stages,
    ...(opts.collectProposals ? { proposals: collected, text: docText(normalised) } : {}),
  };
}
