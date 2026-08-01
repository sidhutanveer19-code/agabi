import type { KnowledgeStore, GraphDump } from "@/server/knowledge/store/KnowledgeStore";
import { isAcyclic as depsAcyclic, findCycle as depCycle } from "@/server/knowledge/graph/dependency";
import { isAcyclic as compAcyclic, findCycle as compCycle } from "@/server/knowledge/graph/composition";

/**
 * Whole-graph integrity (Stage 4). `npm test` proves the checking LOGIC over synthetic fixtures; it
 * proves nothing about a run's data. This checks the real graph, and it checks the things a walk
 * from concepts structurally cannot see:
 *
 *  · dangling provenance — a Provenance row whose Source or SourceChunk does not exist. Before A2
 *    nothing wrote those rows at all, so every provenance row dangled and grounding could never be
 *    re-verified after the run.
 *  · dangling edges — an edge endpoint that is not a concept.
 *  · unattached statements — a statement with no `subjectId`, reachable from no concept and
 *    therefore invisible to teaching, coverage and review-by-concept alike (A-5).
 *  · orphan assets/items — attached to a concept id that does not exist.
 *  · cycles in the dependency and composition graphs.
 *
 * Every violation is returned WITH its ids, never as a bare count (R1): a number you cannot expand
 * into the rows it stands for is not evidence.
 */

export interface Violation {
  check: string;
  severity: "error" | "warning";
  count: number;
  ids: string[]; // the actual offenders (capped for printing, `count` is the truth)
  reason: string;
}

export interface IntegrityReport {
  totals: {
    concepts: number;
    statements: number;
    provenance: number;
    sources: number;
    sourceChunks: number;
    edges: number;
    assets: number;
    items: number;
    reviewEvents: number;
  };
  metrics: {
    subjectAttachment: number; // statements with a subjectId ÷ statements  (A-5 target ≥0.95)
    provenanceIntegrity: number; // statements with ≥1 provenance ÷ statements (target 1.0)
    provenanceResolvability: number; // provenance rows whose source AND chunk exist ÷ provenance (target 1.0)
  };
  violations: Violation[];
  ok: boolean; // no error-severity violations
}

const ID_CAP = 25;

function violation(check: string, severity: Violation["severity"], ids: string[], reason: string): Violation | null {
  if (ids.length === 0) return null;
  return { check, severity, count: ids.length, ids: ids.slice(0, ID_CAP), reason };
}

export function checkIntegrity(dump: GraphDump): IntegrityReport {
  const conceptIds = new Set(dump.concepts.map((c) => c.id));
  const statementIds = new Set(dump.statements.map((s) => s.id));
  const sourceIds = new Set(dump.sources.map((s) => s.id));
  const chunkIds = new Set(dump.sourceChunks.map((c) => c.id));

  const provStatements = new Set(dump.provenance.map((p) => p.statementId));
  const danglingProv = dump.provenance.filter((p) => !sourceIds.has(p.sourceId) || !chunkIds.has(p.chunkId));
  const orphanProv = dump.provenance.filter((p) => !statementIds.has(p.statementId));
  const unattached = dump.statements.filter((s) => !s.subjectId);
  const ungrounded = dump.statements.filter((s) => !provStatements.has(s.id));
  const badSubject = dump.statements.filter((s) => s.subjectId && !conceptIds.has(s.subjectId));

  const edgeEnds: { id: string; ends: string[] }[] = [
    ...dump.dependencyEdges.map((e) => ({ id: `dep:${e.fromId}->${e.toId}`, ends: [e.fromId, e.toId] })),
    ...dump.compositionEdges.map((e) => ({ id: `comp:${e.partId}->${e.wholeId}`, ends: [e.partId, e.wholeId] })),
    ...dump.reinforcementEdges.map((e) => ({ id: `rein:${e.fromId}->${e.toId}`, ends: [e.fromId, e.toId] })),
  ];
  const danglingEdges = edgeEnds.filter((e) => e.ends.some((x) => !conceptIds.has(x))).map((e) => e.id);

  const orphanAssets = dump.teachingAssets.filter((a) => !conceptIds.has(a.conceptId)).map((a) => a.id);
  const orphanItemLinks = dump.itemConcepts.filter((l) => !conceptIds.has(l.conceptId)).map((l) => `${l.itemId}->${l.conceptId}`);

  const dCycle = depsAcyclic(dump.dependencyEdges) ? [] : [(depCycle(dump.dependencyEdges) ?? []).join(" → ")];
  const cCycle = compAcyclic(dump.compositionEdges) ? [] : [(compCycle(dump.compositionEdges) ?? []).join(" → ")];

  const violations = [
    violation("dangling-provenance", "error", danglingProv.map((p) => `${p.statementId}@${p.chunkId}`), "provenance points at a Source or SourceChunk that does not exist — grounding cannot be re-verified and review has no passage to show"),
    violation("orphan-provenance", "error", orphanProv.map((p) => p.statementId), "provenance references a statement that does not exist"),
    violation("dangling-edge", "error", danglingEdges, "edge endpoint is not a concept"),
    violation("bad-subject", "error", badSubject.map((s) => s.id), "statement.subjectId references a concept that does not exist"),
    violation("dependency-cycle", "error", dCycle, "the dependency graph must be acyclic (V7)"),
    violation("composition-cycle", "error", cCycle, "the composition graph must be acyclic (V8)"),
    violation("orphan-asset", "error", orphanAssets, "teaching asset attached to a concept that does not exist"),
    violation("orphan-item-link", "error", orphanItemLinks, "assessment item linked to a concept that does not exist"),
    violation("unattached-statement", "warning", unattached.map((s) => s.id), "statement has no subjectId — reachable from no concept, so invisible to teaching and coverage (A-5)"),
    violation("ungrounded-statement", "warning", ungrounded.map((s) => s.id), "statement has no provenance row — it traces to no source"),
  ].filter((v): v is Violation => v !== null);

  const rate = (num: number, den: number) => (den === 0 ? 1 : num / den);
  return {
    totals: {
      concepts: dump.concepts.length,
      statements: dump.statements.length,
      provenance: dump.provenance.length,
      sources: dump.sources.length,
      sourceChunks: dump.sourceChunks.length,
      edges: dump.dependencyEdges.length + dump.compositionEdges.length + dump.reinforcementEdges.length,
      assets: dump.teachingAssets.length,
      items: dump.assessmentItems.length,
      reviewEvents: dump.reviewEvents.length,
    },
    metrics: {
      subjectAttachment: rate(dump.statements.length - unattached.length, dump.statements.length),
      provenanceIntegrity: rate(dump.statements.length - ungrounded.length, dump.statements.length),
      provenanceResolvability: rate(dump.provenance.length - danglingProv.length, dump.provenance.length),
    },
    violations,
    ok: violations.every((v) => v.severity !== "error"),
  };
}

export async function integrityReport(store: KnowledgeStore): Promise<IntegrityReport> {
  return checkIntegrity(await store.dumpAll());
}
