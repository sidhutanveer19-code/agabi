import { describe, it, expect } from "vitest";
import { checkIntegrity, integrityReport, type Violation, type IntegrityReport } from "@/server/knowledge/integrity";
import type { GraphDump } from "@/server/knowledge/store/KnowledgeStore";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import type {
  Concept,
  Statement,
  Provenance,
  Source,
  SourceChunk,
  DependencyEdge,
  CompositionEdge,
  ReinforcementEdge,
  TeachingAsset,
  AssessmentItem,
  ItemConcept,
  ReviewEvent,
} from "@/server/knowledge/types";

/**
 * Whole-graph integrity (Stage 4) — checkIntegrity/integrityReport. These tests attack the checking
 * LOGIC over synthetic fixtures: every violation both fires and stays silent, every metric denominator
 * (empty vs non-empty), the ID cap, and the async wiring through a real memory store. Fixtures set ONLY
 * the fields each check reads; everything else is a typed default.
 */

// ── minimal, fully-typed record builders (only the fields the checks read carry meaning) ──
const concept = (id: string): Concept => ({
  id, slug: id, name: id, kind: "ENTITY", scope: "PUBLIC", status: "ACTIVE",
  version: 1, supersedes: null, mergedInto: null, splitInto: [], createdAt: new Date(0),
});

const statement = (id: string, subjectId: string | null): Statement => ({
  id, kind: "FACT", form: "SPO", structure: {}, subjectId, predicate: null, objectId: null,
  objectLit: null, text: "", payload: {}, contextId: "ctx", scope: "PUBLIC",
  trustLevel: "MACHINE_PROPOSED", validationMethods: [], corroborationCount: 0,
  independentSourceCount: 0, derivedFrom: [], authority: null, evidenceLevel: null,
  version: 1, supersedes: null, createdAt: new Date(0), disputed: false, disputeReason: null,
  disputedAt: null, priorTrustLevel: null,
});

const source = (id: string): Source => ({
  id, kind: "BOOK", title: "", publisher: "", authority: "", edition: null, publishedAt: null,
  uri: null, checksum: "", license: "", licenseUrl: null, ingestedAt: new Date(0),
});

const chunk = (id: string, sourceId = "src1"): SourceChunk => ({
  id, sourceId, locator: { page: 1, range: [0, 1] }, text: "", ordinal: 0,
});

const prov = (statementId: string, sourceId: string, chunkId: string): Provenance => ({
  statementId, sourceId, chunkId, locator: null, quote: "", extractorVersion: "",
  promptVersion: "", modelId: "", extractedAt: new Date(0),
});

const depEdge = (fromId: string, toId: string): DependencyEdge => ({ fromId, toId, strength: 1, contextId: null, version: 1, supersedes: null });
const compEdge = (partId: string, wholeId: string): CompositionEdge => ({ partId, wholeId, ordinal: null, version: 1 });
const reinEdge = (fromId: string, toId: string): ReinforcementEdge => ({ fromId, toId, type: "REINFORCES", strength: 1, earned: false, contextId: null, version: 1 });

const asset = (id: string, conceptId: string): TeachingAsset => ({
  id, kind: "ANALOGY", conceptId, statementId: null, payload: {}, contextId: "ctx",
  trustLevel: "MACHINE_PROPOSED", scope: "PUBLIC", version: 1, supersedes: null,
});

const item = (id: string): AssessmentItem => ({
  id, kind: "MCQ", prompt: "", payload: {}, contextId: "ctx", scope: "PUBLIC",
  trustLevel: "MACHINE_PROPOSED", version: 1, supersedes: null,
});

const itemConcept = (itemId: string, conceptId: string): ItemConcept => ({ itemId, conceptId, role: "PRIMARY", bloom: null });

const reviewEvent = (id: string): ReviewEvent => ({
  id, targetKind: "Statement", targetId: "s1", decision: "APPROVE", fromTrust: null,
  toTrust: null, actorId: "human", before: null, after: null, reason: null, batchId: null,
  createdAt: new Date(0),
});

const emptyDump = (over: Partial<GraphDump> = {}): GraphDump => ({
  concepts: [], conceptAliases: [], conceptTags: [], contexts: [], statements: [],
  provenance: [], sources: [], sourceChunks: [], dependencyEdges: [], compositionEdges: [],
  reinforcementEdges: [], reviewEvents: [], teachingAssets: [], assessmentItems: [],
  itemConcepts: [], programs: [], programNodes: [], mappings: [], releases: [], releaseMembers: [],
  ...over,
});

const find = (r: IntegrityReport, check: string): Violation | undefined => r.violations.find((v) => v.check === check);

describe("checkIntegrity — empty and clean graphs", () => {
  it("empty graph: no violations, ok, all totals 0, every metric defaults to 1 (rate den===0 branch)", () => {
    const r = checkIntegrity(emptyDump());
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.totals).toEqual({
      concepts: 0, statements: 0, provenance: 0, sources: 0, sourceChunks: 0,
      edges: 0, assets: 0, items: 0, reviewEvents: 0,
    });
    expect(r.metrics).toEqual({ subjectAttachment: 1, provenanceIntegrity: 1, provenanceResolvability: 1 });
  });

  it("a fully valid small graph produces zero violations and ok=true (every check's ids.length===0 → null)", () => {
    const r = checkIntegrity(emptyDump({
      concepts: [concept("c1"), concept("c2")],
      statements: [statement("s1", "c1")],
      provenance: [prov("s1", "src1", "chunk1")],
      sources: [source("src1")],
      sourceChunks: [chunk("chunk1")],
      dependencyEdges: [depEdge("c1", "c2")],
      compositionEdges: [compEdge("c1", "c2")],
      reinforcementEdges: [reinEdge("c1", "c2")],
      teachingAssets: [asset("a1", "c1")],
      assessmentItems: [item("i1")],
      itemConcepts: [itemConcept("i1", "c1")],
      reviewEvents: [reviewEvent("r1")],
    }));
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
    // valid edges exercise the danglingEdges .some()===false and both acyclic ternaries → []
    expect(find(r, "dependency-cycle")).toBeUndefined();
    expect(find(r, "composition-cycle")).toBeUndefined();
    expect(find(r, "dangling-edge")).toBeUndefined();
    expect(r.metrics).toEqual({ subjectAttachment: 1, provenanceIntegrity: 1, provenanceResolvability: 1 });
    expect(r.totals).toEqual({
      concepts: 2, statements: 1, provenance: 1, sources: 1, sourceChunks: 1,
      edges: 3, assets: 1, items: 1, reviewEvents: 1,
    });
  });
});

describe("checkIntegrity — dangling provenance (both sides of the OR)", () => {
  it("source missing but chunk present → dangling; id is `statementId@chunkId`; resolvability drops to 0", () => {
    const r = checkIntegrity(emptyDump({
      concepts: [concept("c1")],
      statements: [statement("s1", "c1")],
      provenance: [prov("s1", "srcMISSING", "chunk1")],
      sources: [], // source absent → left side of the OR true
      sourceChunks: [chunk("chunk1")],
    }));
    const v = find(r, "dangling-provenance")!;
    expect(v).toBeDefined();
    expect(v.severity).toBe("error");
    expect(v.count).toBe(1);
    expect(v.ids).toEqual(["s1@chunk1"]);
    expect(v.reason).toBe("provenance points at a Source or SourceChunk that does not exist — grounding cannot be re-verified and review has no passage to show");
    // isolated: no orphan-provenance (statement exists), no ungrounded (has a prov row)
    expect(find(r, "orphan-provenance")).toBeUndefined();
    expect(find(r, "ungrounded-statement")).toBeUndefined();
    expect(r.metrics.provenanceResolvability).toBe(0);
    expect(r.ok).toBe(false);
  });

  it("chunk missing but source present → dangling (right side of the OR)", () => {
    const r = checkIntegrity(emptyDump({
      concepts: [concept("c1")],
      statements: [statement("s1", "c1")],
      provenance: [prov("s1", "src1", "chunkMISSING")],
      sources: [source("src1")],
      sourceChunks: [], // chunk absent → right side of the OR true
    }));
    const v = find(r, "dangling-provenance")!;
    expect(v.count).toBe(1);
    expect(v.ids).toEqual(["s1@chunkMISSING"]);
    expect(r.metrics.provenanceResolvability).toBe(0);
  });
});

describe("checkIntegrity — orphan provenance", () => {
  it("provenance referencing a non-existent statement fires; source+chunk present so it is NOT dangling", () => {
    const r = checkIntegrity(emptyDump({
      provenance: [prov("sMISSING", "src1", "chunk1")],
      sources: [source("src1")],
      sourceChunks: [chunk("chunk1")],
    }));
    const v = find(r, "orphan-provenance")!;
    expect(v.severity).toBe("error");
    expect(v.count).toBe(1);
    expect(v.ids).toEqual(["sMISSING"]);
    expect(v.reason).toBe("provenance references a statement that does not exist");
    expect(find(r, "dangling-provenance")).toBeUndefined();
    // provenance resolves (source+chunk exist) → resolvability stays 1
    expect(r.metrics.provenanceResolvability).toBe(1);
    expect(r.ok).toBe(false);
  });
});

describe("checkIntegrity — dangling edges across all three graphs", () => {
  it("dep/comp/rein each with one bad endpoint → three ids with the right prefixes and order", () => {
    const r = checkIntegrity(emptyDump({
      concepts: [concept("c1")],
      dependencyEdges: [depEdge("c1", "X")], // second end missing
      compositionEdges: [compEdge("Y", "c1")], // first end missing (part)
      reinforcementEdges: [reinEdge("c1", "Z")], // second end missing
    }));
    const v = find(r, "dangling-edge")!;
    expect(v.severity).toBe("error");
    expect(v.count).toBe(3);
    expect(v.ids).toEqual(["dep:c1->X", "comp:Y->c1", "rein:c1->Z"]);
    expect(v.reason).toBe("edge endpoint is not a concept");
    expect(r.ok).toBe(false);
  });

  it("first endpoint missing is caught too (.some over both ends)", () => {
    const r = checkIntegrity(emptyDump({
      concepts: [concept("c1")],
      dependencyEdges: [depEdge("MISSING", "c1")],
    }));
    expect(find(r, "dangling-edge")!.ids).toEqual(["dep:MISSING->c1"]);
  });
});

describe("checkIntegrity — bad subject vs unattached (the s.subjectId && ... branches)", () => {
  it("subjectId points at a non-existent concept → bad-subject error (truthy && not-a-concept)", () => {
    const r = checkIntegrity(emptyDump({
      concepts: [concept("c1")],
      statements: [statement("s1", "ghost")],
      provenance: [prov("s1", "src1", "chunk1")], // grounded, so ungrounded stays silent
      sources: [source("src1")],
      sourceChunks: [chunk("chunk1")],
    }));
    const v = find(r, "bad-subject")!;
    expect(v.severity).toBe("error");
    expect(v.count).toBe(1);
    expect(v.ids).toEqual(["s1"]);
    expect(v.reason).toBe("statement.subjectId references a concept that does not exist");
    expect(find(r, "unattached-statement")).toBeUndefined(); // subjectId is truthy
    expect(r.ok).toBe(false);
  });

  it("empty-string subjectId is unattached (falsy) and NOT bad-subject (short-circuits the &&)", () => {
    const r = checkIntegrity(emptyDump({
      statements: [statement("s1", "")],
      provenance: [prov("s1", "src1", "chunk1")],
      sources: [source("src1")],
      sourceChunks: [chunk("chunk1")],
    }));
    expect(find(r, "unattached-statement")!.ids).toEqual(["s1"]);
    expect(find(r, "bad-subject")).toBeUndefined();
    expect(r.metrics.subjectAttachment).toBe(0);
    expect(r.ok).toBe(true); // only a warning
  });
});

describe("checkIntegrity — warning-only graph keeps ok=true", () => {
  it("a null-subject, ungrounded statement yields two WARNINGS and ok stays true (severity!=='error')", () => {
    const r = checkIntegrity(emptyDump({
      statements: [statement("s1", null)],
    }));
    expect(r.violations).toHaveLength(2);
    expect(r.violations.every((v) => v.severity === "warning")).toBe(true);
    const unattached = find(r, "unattached-statement")!;
    expect(unattached.ids).toEqual(["s1"]);
    expect(unattached.reason).toBe("statement has no subjectId — reachable from no concept, so invisible to teaching and coverage (A-5)");
    const ungrounded = find(r, "ungrounded-statement")!;
    expect(ungrounded.ids).toEqual(["s1"]);
    expect(ungrounded.reason).toBe("statement has no provenance row — it traces to no source");
    expect(r.ok).toBe(true);
    expect(r.metrics.subjectAttachment).toBe(0);
    expect(r.metrics.provenanceIntegrity).toBe(0);
  });
});

describe("checkIntegrity — cycles in dependency and composition graphs", () => {
  it("a 2-node dependency cycle is reported as a joined path; ids exist so it is not a dangling edge", () => {
    const r = checkIntegrity(emptyDump({
      concepts: [concept("a"), concept("b")],
      dependencyEdges: [depEdge("a", "b"), depEdge("b", "a")],
    }));
    const v = find(r, "dependency-cycle")!;
    expect(v.severity).toBe("error");
    expect(v.count).toBe(1);
    expect(v.ids).toEqual(["a → b → a"]);
    expect(v.reason).toBe("the dependency graph must be acyclic (V7)");
    expect(find(r, "dangling-edge")).toBeUndefined();
    expect(r.ok).toBe(false);
  });

  it("a 2-node composition cycle is reported", () => {
    const r = checkIntegrity(emptyDump({
      concepts: [concept("p"), concept("q")],
      compositionEdges: [compEdge("p", "q"), compEdge("q", "p")],
    }));
    const v = find(r, "composition-cycle")!;
    expect(v.ids).toEqual(["p → q → p"]);
    expect(v.reason).toBe("the composition graph must be acyclic (V8)");
    expect(r.ok).toBe(false);
  });
});

describe("checkIntegrity — orphan assets and item links", () => {
  it("teaching asset on a non-existent concept → orphan-asset with the asset id", () => {
    const r = checkIntegrity(emptyDump({
      teachingAssets: [asset("a1", "ghost")],
    }));
    const v = find(r, "orphan-asset")!;
    expect(v.severity).toBe("error");
    expect(v.count).toBe(1);
    expect(v.ids).toEqual(["a1"]);
    expect(v.reason).toBe("teaching asset attached to a concept that does not exist");
    expect(r.ok).toBe(false);
  });

  it("item link to a non-existent concept → orphan-item-link id is `itemId->conceptId`", () => {
    const r = checkIntegrity(emptyDump({
      itemConcepts: [itemConcept("i1", "ghost")],
    }));
    const v = find(r, "orphan-item-link")!;
    expect(v.severity).toBe("error");
    expect(v.count).toBe(1);
    expect(v.ids).toEqual(["i1->ghost"]);
    expect(v.reason).toBe("assessment item linked to a concept that does not exist");
    expect(r.ok).toBe(false);
  });
});

describe("checkIntegrity — the ID_CAP (25): count is the truth, ids are capped", () => {
  it("30 orphan assets → count===30 but ids capped at 25, in dump order", () => {
    const assets = Array.from({ length: 30 }, (_, i) => asset(`a${i}`, "ghost"));
    const r = checkIntegrity(emptyDump({ teachingAssets: assets }));
    const v = find(r, "orphan-asset")!;
    expect(v.count).toBe(30);
    expect(v.ids).toHaveLength(25);
    expect(v.ids[0]).toBe("a0");
    expect(v.ids[24]).toBe("a24");
    expect(v.ids).not.toContain("a25");
  });

  it("exactly 25 offenders are all kept (boundary, not truncated)", () => {
    const assets = Array.from({ length: 25 }, (_, i) => asset(`a${i}`, "ghost"));
    const v = find(checkIntegrity(emptyDump({ teachingAssets: assets })), "orphan-asset")!;
    expect(v.count).toBe(25);
    expect(v.ids).toHaveLength(25);
  });
});

describe("checkIntegrity — metrics and totals over a mixed graph (rate den>0 branch)", () => {
  it("computes exact attachment/integrity/resolvability fractions and exact totals", () => {
    const r = checkIntegrity(emptyDump({
      concepts: [concept("c1"), concept("c2")],
      statements: [
        statement("s1", "c1"), // grounded, attached
        statement("s2", null), // unattached + ungrounded
        statement("s3", "c2"), // attached, ungrounded (no prov row)
        statement("s4", "c1"), // grounded, attached
      ],
      provenance: [
        prov("s1", "src1", "chunk1"), // valid
        prov("s4", "src1", "chunk1"), // valid
        prov("s1", "srcMISSING", "chunk1"), // dangling (source gone)
        prov("s4", "src1", "chunkMISSING"), // dangling (chunk gone)
        prov("s1", "src1", "chunk1"), // valid duplicate
      ],
      sources: [source("src1")],
      sourceChunks: [chunk("chunk1")],
      dependencyEdges: [depEdge("c1", "c2")],
      compositionEdges: [compEdge("c1", "c2")],
      reinforcementEdges: [reinEdge("c1", "c2")],
      teachingAssets: [asset("a1", "c1")],
      assessmentItems: [item("i1")],
      itemConcepts: [itemConcept("i1", "c1")],
      reviewEvents: [reviewEvent("r1")],
    }));
    // 4 statements, 1 unattached → 3/4
    expect(r.metrics.subjectAttachment).toBe(0.75);
    // 4 statements, 2 without a provenance row (s2, s3) → 2/4
    expect(r.metrics.provenanceIntegrity).toBe(0.5);
    // 5 provenance rows, 2 dangling → 3/5
    expect(r.metrics.provenanceResolvability).toBeCloseTo(0.6, 10);
    expect(r.totals).toEqual({
      concepts: 2, statements: 4, provenance: 5, sources: 1, sourceChunks: 1,
      edges: 3, assets: 1, items: 1, reviewEvents: 1,
    });
    expect(find(r, "dangling-provenance")!.count).toBe(2);
    expect(find(r, "dangling-provenance")!.ids).toEqual(["s1@chunk1", "s4@chunkMISSING"]);
    expect(r.ok).toBe(false);
  });
});

describe("integrityReport — async wiring through a real memory store", () => {
  it("an empty store reports clean, all-zero totals, all metrics 1, ok=true", async () => {
    const store = createMemoryStore();
    const r = await integrityReport(store);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.totals.concepts).toBe(0);
    expect(r.totals.assets).toBe(0);
    expect(r.metrics).toEqual({ subjectAttachment: 1, provenanceIntegrity: 1, provenanceResolvability: 1 });
  });

  it("a stored orphan asset surfaces through dumpAll → checkIntegrity as an error", async () => {
    const store = createMemoryStore();
    await store.putConcept(concept("c1"));
    await store.putTeachingAsset(asset("a1", "ghost")); // concept 'ghost' never stored
    const r = await integrityReport(store);
    expect(r.totals.concepts).toBe(1);
    expect(r.totals.assets).toBe(1);
    const v = find(r, "orphan-asset")!;
    expect(v.ids).toEqual(["a1"]);
    expect(r.ok).toBe(false);
  });
});
