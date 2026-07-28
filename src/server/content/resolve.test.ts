import { describe, it, expect } from "vitest";
import { Resolver } from "@/server/content/resolve";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type {
  Concept,
  Statement,
  Provenance,
  DependencyEdge,
  CompositionEdge,
  ReinforcementEdge,
  TeachingAsset,
  AssessmentItem,
  ItemConcept,
  SlugResolution,
  Scope,
} from "@/server/knowledge/types";
import type { RawStatement, RawDependency, RawAsset } from "@/server/knowledge/extraction/types";
import type { Chunk } from "@/server/ingest/chunk";
import { pass, type ValidationResult } from "@/server/knowledge/validators";
import { buildConcept } from "@/server/knowledge/concept";
import { slugify } from "@/server/knowledge/ids";

/**
 * Resolver (content/resolve.ts) — the resolve-and-persist bridge (W1).
 *
 * The ONLY I/O edge is the injected `KnowledgeStore`; it is faked here by a REALISTIC
 * in-memory store so idempotency/dedup/round-trip are exercised for real (a per-call stub
 * would prove nothing). Everything else — nameIn/subject/objectNameOf reading, resolveConcept
 * caching + slug reuse + DRAFT minting, SPO vs non-SPO structure assembly, the AUTO_VALIDATED
 * ceiling (validatorsPass), the aboutness dedup on EVERY form, the three edge graphs, asset +
 * item persistence, buildItem's validation gate, and every R1 omission — is the module's own
 * logic and is asserted on its EXACT output, never "it ran".
 *
 * Branches covered: nameIn (undefined structure / non-string / empty-after-trim / valid);
 * subject/objectNameOf (top-level truthy / whitespace→structure / absent→structure→absent);
 * resolveConcept (cache hit / slug reuse / ambiguous→fresh DRAFT); persistStatement (subject
 * resolved vs unresolved omission, object concept vs objectLit vs neither, contextDimensions
 * present vs `?? {}`, dedup hit on objectId / objectLit / null==null / non-SPO form / dedup
 * miss, validation default []→MACHINE_PROPOSED, all-pass→AUTO_VALIDATED, partial→MACHINE_PROPOSED);
 * persistDependency (REQUIRES/PART_OF/REINFORCEMENT create + each duplicate skip + type `?? REINFORCES`);
 * persistAsset (create / identical skip / different-payload miss); persistItem (create+link /
 * identical skip / rejected-by-buildItem omission); default scope PUBLIC vs explicit tenant.
 */

// ── the sole I/O edge: a realistic in-memory KnowledgeStore ──
class FakeStore {
  readonly bySlug = new Map<string, Concept>();
  readonly byId = new Map<string, Concept>();
  readonly forced = new Map<string, SlugResolution>();
  readonly statements: Statement[] = [];
  readonly provenance: Provenance[] = [];
  readonly dependency: DependencyEdge[] = [];
  readonly composition: CompositionEdge[] = [];
  readonly reinforcement: ReinforcementEdge[] = [];
  readonly assets: TeachingAsset[] = [];
  readonly items: AssessmentItem[] = [];
  readonly itemConcepts: ItemConcept[] = [];

  seed(concept: Concept): void {
    this.bySlug.set(concept.slug, concept);
    this.byId.set(concept.id, concept);
  }

  async resolveSlug(slug: string): Promise<SlugResolution> {
    const forced = this.forced.get(slug);
    if (forced) return forced;
    const c = this.bySlug.get(slug);
    return c ? { kind: "concept", conceptId: c.id } : { kind: "none" };
  }
  async putConcept(concept: Concept): Promise<void> {
    this.bySlug.set(concept.slug, concept);
    this.byId.set(concept.id, concept);
  }
  async statementsForSubject(subjectId: string): Promise<Statement[]> {
    return this.statements.filter((s) => s.subjectId === subjectId);
  }
  async putContext(dimensions: Record<string, unknown>): Promise<{ id: string }> {
    return { id: "ctx_" + JSON.stringify(dimensions) };
  }
  async putStatement(s: Statement): Promise<void> {
    this.statements.push(s);
  }
  async putProvenance(p: Provenance): Promise<void> {
    this.provenance.push(p);
  }
  async dependencyEdges(): Promise<DependencyEdge[]> {
    return this.dependency;
  }
  async putDependencyEdge(e: DependencyEdge): Promise<void> {
    this.dependency.push(e);
  }
  async compositionEdges(): Promise<CompositionEdge[]> {
    return this.composition;
  }
  async putCompositionEdge(e: CompositionEdge): Promise<void> {
    this.composition.push(e);
  }
  async reinforcementEdges(): Promise<ReinforcementEdge[]> {
    return this.reinforcement;
  }
  async putReinforcementEdge(e: ReinforcementEdge): Promise<void> {
    this.reinforcement.push(e);
  }
  async assetsForConcept(conceptId: string): Promise<TeachingAsset[]> {
    return this.assets.filter((a) => a.conceptId === conceptId);
  }
  async putTeachingAsset(a: TeachingAsset): Promise<void> {
    this.assets.push(a);
  }
  async itemsForConcept(conceptId: string): Promise<AssessmentItem[]> {
    const ids = new Set(this.itemConcepts.filter((l) => l.conceptId === conceptId).map((l) => l.itemId));
    return this.items.filter((i) => ids.has(i.id));
  }
  async putAssessmentItem(i: AssessmentItem): Promise<void> {
    this.items.push(i);
  }
  async putItemConcept(l: ItemConcept): Promise<void> {
    this.itemConcepts.push(l);
  }
}

type RawItemArg = Parameters<Resolver["persistItem"]>[0];

function makeResolver(scope?: Scope): { store: FakeStore; resolver: Resolver } {
  const store = new FakeStore();
  const asStore = store as unknown as KnowledgeStore;
  const resolver = scope
    ? new Resolver(asStore, "src_1", "model_1", scope)
    : new Resolver(asStore, "src_1", "model_1"); // 3-arg → exercises the default scope param
  return { store, resolver };
}

function stmt(over: Partial<RawStatement> = {}): RawStatement {
  return { form: "SPO", kind: "FACT", text: "default text", quote: "default quote", structure: {}, ...over };
}

function chunk(over: Partial<Chunk> = {}): Chunk {
  return { id: "chunk_1", sourceId: "src_1", locator: { page: 1, range: [0, 10] }, text: "passage text", ordinal: 0, ...over };
}

const idOf = (store: FakeStore, name: string): string => {
  const c = store.bySlug.get(slugify(name));
  if (!c) throw new Error(`no concept for ${name}`);
  return c.id;
};

// ─────────────────────────────── resolveConcept ───────────────────────────────
describe("Resolver.resolveConcept (via persistAsset / persistDependency)", () => {
  it("mints a DRAFT concept the first time a name is seen, then caches it within the run", async () => {
    const { store, resolver } = makeResolver();

    await resolver.persistAsset({ kind: "ANALOGY", conceptName: "Photosynthesis", payload: { breakdownPoint: "x" } }, chunk());
    // second asset, SAME name, DIFFERENT payload → resolveConcept cache hit, no new concept
    await resolver.persistAsset({ kind: "ANALOGY", conceptName: "Photosynthesis", payload: { other: "y" } }, chunk());

    const created = store.bySlug.get("photosynthesis");
    expect(created).toBeDefined();
    expect(created!.name).toBe("Photosynthesis");
    expect(created!.slug).toBe("photosynthesis");
    expect(created!.status).toBe("DRAFT");
    expect(created!.scope).toBe("PUBLIC");
    expect(resolver.counts.concepts).toBe(1); // NOT 2 — the cache prevented a second mint
    expect(resolver.counts.assets).toBe(2);
    expect(store.assets[0].conceptId).toBe(created!.id);
    expect(store.assets[1].conceptId).toBe(created!.id);
  });

  it("reuses an existing concept resolved by slug instead of minting a fresh DRAFT", async () => {
    const { store, resolver } = makeResolver();
    const existing = buildConcept({ name: "Energy", scope: "PUBLIC" });
    store.seed(existing);

    await resolver.persistAsset({ kind: "WORKED_EXAMPLE", conceptName: "Energy", payload: { step: 1 } }, chunk());

    expect(resolver.counts.concepts).toBe(0); // reused, nothing minted
    expect(store.assets[0].conceptId).toBe(existing.id);
  });

  it("an ambiguous slug resolution is treated as not-found → a fresh DRAFT is minted", async () => {
    const { store, resolver } = makeResolver();
    store.forced.set("split-concept", { kind: "ambiguous", candidates: ["c1", "c2"] });

    await resolver.persistDependency({ fromName: "Split Concept", toName: "Other", classification: "REQUIRES" });

    // both endpoints minted (ambiguous did NOT reuse a candidate)
    expect(resolver.counts.concepts).toBe(2);
    expect(store.byId.get(idOf(store, "Split Concept"))!.status).toBe("DRAFT");
    expect(store.dependency).toHaveLength(1);
  });
});

// ─────────────────────────────── persistStatement: SPO + trust + provenance ───────────────────────────────
describe("Resolver.persistStatement — SPO happy path, trust ceiling, provenance", () => {
  it("resolves subject+object, denormalises predicate/objectId, defaults MACHINE_PROPOSED, writes exact provenance", async () => {
    const { store, resolver } = makeResolver();
    const raw = stmt({ form: "SPO", kind: "FACT", text: "The sun emits light.", quote: "the sun emits light", subject: "Sun", predicate: "emits", object: "Light", contextDimensions: { grade: "10" } });
    const ch = chunk();

    const id = await resolver.persistStatement(raw, ch);

    expect(store.statements).toHaveLength(1);
    const s = store.statements[0];
    expect(s.id).toBe(id);
    expect(s.form).toBe("SPO");
    expect(s.kind).toBe("FACT");
    expect(s.text).toBe("The sun emits light.");

    const sunId = idOf(store, "Sun");
    const lightId = idOf(store, "Light");
    expect(s.subjectId).toBe(sunId);
    expect(s.objectId).toBe(lightId);
    expect(s.predicate).toBe("emits");
    expect(s.objectLit).toBeNull();
    expect(s.structure).toEqual({ subjectId: sunId, predicate: "emits", objectId: lightId });
    expect(s.contextId).toBe("ctx_" + JSON.stringify({ grade: "10" }));

    // MACHINE_PROPOSED because no validation was supplied (default [])
    expect(s.trustLevel).toBe("MACHINE_PROPOSED");
    expect(s.validationMethods).toEqual([]);
    expect(s.independentSourceCount).toBe(0);

    expect(resolver.counts.concepts).toBe(2);
    expect(resolver.counts.statements).toBe(1);
    expect(resolver.counts.provenance).toBe(1);

    const p = store.provenance[0];
    expect(p.statementId).toBe(id);
    expect(p.sourceId).toBe("src_1");
    expect(p.chunkId).toBe("chunk_1");
    expect(p.locator).toEqual(ch.locator);
    expect(p.quote).toBe("the sun emits light");
    expect(p.extractorVersion).toBe("knowledge-extract@2");
    expect(p.promptVersion).toBe("knowledge-extract@2");
    expect(p.modelId).toBe("model_1");
    expect(p.extractedAt).toBeInstanceOf(Date);
  });

  it("SPO with objectLit (no object concept) stores the literal and mints no object concept", async () => {
    const { store, resolver } = makeResolver();
    const raw = stmt({ form: "SPO", kind: "FACT", text: "Water boils at 100C.", subject: "Water", predicate: "boils_at", objectLit: "100C" });

    await resolver.persistStatement(raw, chunk());

    const s = store.statements[0];
    expect(s.objectLit).toBe("100C");
    expect(s.objectId).toBeNull();
    expect(s.structure).toEqual({ subjectId: idOf(store, "Water"), predicate: "boils_at", objectLit: "100C" });
    expect(resolver.counts.concepts).toBe(1); // Water only — objectLit is not a concept
  });

  it("validation that passes EVERY gate lifts trust to AUTO_VALIDATED with methods + one source", async () => {
    const { store, resolver } = makeResolver();
    const validation: ValidationResult[] = [pass("V3"), pass("V11")];

    await resolver.persistStatement(stmt({ subject: "Atom", predicate: "has", object: "Nucleus" }), chunk(), validation);

    const s = store.statements[0];
    expect(s.trustLevel).toBe("AUTO_VALIDATED");
    expect(s.validationMethods).toEqual(["V3", "V11"]);
    expect(s.independentSourceCount).toBe(1);
  });

  it("validation present but not all passing stays MACHINE_PROPOSED (length>0 && validatorsPass=false)", async () => {
    const { store, resolver } = makeResolver();
    const validation: ValidationResult[] = [pass("V3"), { validator: "V4", outcome: "flag" }];

    await resolver.persistStatement(stmt({ subject: "Cell", predicate: "contains", object: "DNA" }), chunk(), validation);

    const s = store.statements[0];
    expect(s.trustLevel).toBe("MACHINE_PROPOSED");
    expect(s.validationMethods).toEqual([]);
    expect(s.independentSourceCount).toBe(0);
  });
});

// ─────────────────────────────── persistStatement: name reading + unresolved subject ───────────────────────────────
describe("Resolver.persistStatement — subject/object name resolution + R1 unresolved", () => {
  it("reads subject AND object from `structure` when the top-level names are absent (A-5)", async () => {
    const { store, resolver } = makeResolver();
    const raw = stmt({ form: "CAUSAL", kind: "PRINCIPLE", text: "Heat causes expansion.", structure: { subject: "Heat", object: "Expansion", note: "n" } });

    await resolver.persistStatement(raw, chunk());

    const s = store.statements[0];
    const heatId = idOf(store, "Heat");
    const expId = idOf(store, "Expansion");
    expect(s.subjectId).toBe(heatId); // aboutness column populated for a non-SPO form
    expect(s.predicate).toBeNull(); // non-SPO → no denormalised predicate
    expect(s.objectId).toBeNull(); // non-SPO → objectId column stays null…
    expect(s.structure).toEqual({ subject: "Heat", object: "Expansion", note: "n", subjectId: heatId, objectId: expId }); // …but ids are woven into structure
    expect(s.contextId).toBe("ctx_" + JSON.stringify({})); // no contextDimensions → `?? {}`
    expect(resolver.counts.concepts).toBe(2);
  });

  it("a whitespace top-level subject falls through to structure.subject (`|| undefined` branch)", async () => {
    const { store, resolver } = makeResolver();
    const raw = stmt({ form: "DEFINITIONAL", kind: "FACT", text: "A cell is the unit of life.", subject: "   ", structure: { subject: "Cell" } });

    await resolver.persistStatement(raw, chunk());

    expect(store.statements[0].subjectId).toBe(idOf(store, "Cell"));
    expect(resolver.counts.concepts).toBe(1);
    expect(resolver.omissions).toHaveLength(0); // subject WAS resolvable
  });

  it("non-string / empty structure values resolve to no subject → statement persisted BUT an R1 omission is recorded", async () => {
    const { store, resolver } = makeResolver();
    const raw = stmt({ form: "SPO", kind: "FACT", text: "Orphan statement.", structure: { subject: 42, object: "   " } });

    const id = await resolver.persistStatement(raw, chunk({ id: "chk_orphan" }));

    expect(store.statements).toHaveLength(1); // NEVER dropped — R1
    expect(store.statements[0].id).toBe(id);
    expect(store.statements[0].subjectId).toBeNull();
    expect(store.statements[0].structure).toEqual({ predicate: "" }); // SPO with no subjectId/objectId, predicate `?? ""`
    expect(resolver.counts.statements).toBe(1);
    expect(resolver.counts.concepts).toBe(0); // neither name was usable

    const om = resolver.omissions.find((o) => o.kind === "subject-unresolved");
    expect(om).toBeDefined();
    expect(om!.stage).toBe("resolve");
    expect(om!.chunkId).toBe("chk_orphan");
    expect(om!.reason).toContain("form=SPO");
    expect(om!.data).toEqual({ form: "SPO", text: "Orphan statement.", structureKeys: ["subject", "object"] });
  });

  it("a non-SPO form with no resolvable subject persists with an untouched structure and an R1 omission", async () => {
    const { store, resolver } = makeResolver();
    const raw = stmt({ form: "CAUSAL", kind: "PRINCIPLE", text: "Something causes something.", structure: { note: "x" } });

    await resolver.persistStatement(raw, chunk());

    const s = store.statements[0];
    expect(s.subjectId).toBeNull();
    expect(s.objectId).toBeNull();
    expect(s.structure).toEqual({ note: "x" }); // no subjectId/objectId woven in
    expect(resolver.counts.concepts).toBe(0);
    const om = resolver.omissions.find((o) => o.kind === "subject-unresolved");
    expect(om).toBeDefined();
    expect(om!.reason).toContain("form=CAUSAL");
  });

  it("unresolved subject with NO structure at all → empty structureKeys and a 160-char text slice", async () => {
    const { resolver } = makeResolver();
    const longText = "x".repeat(200);
    const raw: RawStatement = { form: "SPO", kind: "FACT", text: longText, quote: "q", structure: undefined as unknown as Record<string, unknown> };

    await resolver.persistStatement(raw, chunk());

    const om = resolver.omissions.find((o) => o.kind === "subject-unresolved");
    expect(om).toBeDefined();
    expect(om!.data!.structureKeys).toEqual([]); // Object.keys(undefined ?? {})
    expect(om!.data!.text).toBe("x".repeat(160)); // text.slice(0,160)
  });
});

// ─────────────────────────────── persistStatement: idempotency (dedup) ───────────────────────────────
describe("Resolver.persistStatement — idempotency across every form (A-5 aboutness dedup)", () => {
  it("SPO duplicate (predicate+text+objectId) is a no-op returning the SAME id", async () => {
    const { store, resolver } = makeResolver();
    const raw = stmt({ subject: "Sun", predicate: "emits", object: "Light", text: "The sun emits light." });

    const id1 = await resolver.persistStatement(raw, chunk({ id: "c1" }));
    const id2 = await resolver.persistStatement(raw, chunk({ id: "c2" }));

    expect(id2).toBe(id1);
    expect(store.statements).toHaveLength(1);
    expect(resolver.counts.statements).toBe(1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);

    const om = resolver.omissions.find((o) => o.kind === "duplicate-skipped");
    expect(om).toBeDefined();
    expect(om!.stage).toBe("persist");
    expect(om!.targetId).toBe(id1);
    expect(om!.chunkId).toBe("c2");
    expect(om!.reason).toBe("identical statement already present for this subject");
  });

  it("SPO duplicate via the objectLit comparison branch", async () => {
    const { store, resolver } = makeResolver();
    const raw = stmt({ subject: "Water", predicate: "boils_at", objectLit: "100C", text: "Water boils at 100C." });

    const id1 = await resolver.persistStatement(raw, chunk());
    const id2 = await resolver.persistStatement(raw, chunk());

    expect(id2).toBe(id1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);
    expect(store.statements).toHaveLength(1);
  });

  it("SPO duplicate with neither object concept nor objectLit (null === null)", async () => {
    const { resolver } = makeResolver();
    const raw = stmt({ subject: "Gravity", predicate: "is", text: "Gravity is a force." });

    const id1 = await resolver.persistStatement(raw, chunk());
    const id2 = await resolver.persistStatement(raw, chunk());

    expect(id2).toBe(id1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);
  });

  it("SPO is NOT a duplicate when the object concept differs (dedup MISS → a second statement)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistStatement(stmt({ subject: "Sun", predicate: "emits", object: "Light", text: "same text" }), chunk());
    await resolver.persistStatement(stmt({ subject: "Sun", predicate: "emits", object: "Heat", text: "same text" }), chunk());

    expect(store.statements).toHaveLength(2);
    expect(store.statements[0].id).not.toBe(store.statements[1].id);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
    expect(resolver.counts.concepts).toBe(3); // Sun, Light, Heat
  });

  it("non-SPO duplicate dedups on form+text", async () => {
    const { store, resolver } = makeResolver();
    const raw = stmt({ form: "DEFINITIONAL", kind: "FACT", text: "A vector has magnitude and direction.", structure: { subject: "Vector" } });

    const id1 = await resolver.persistStatement(raw, chunk());
    const id2 = await resolver.persistStatement(raw, chunk());

    expect(id2).toBe(id1);
    expect(store.statements).toHaveLength(1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);
  });
});

// ─────────────────────────────── persistDependency ───────────────────────────────
describe("Resolver.persistDependency — three graphs, each with its duplicate skip", () => {
  it("REQUIRES edge is created between resolved concepts", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Algebra", toName: "Arithmetic", classification: "REQUIRES" });

    expect(store.dependency).toEqual([{ fromId: idOf(store, "Algebra"), toId: idOf(store, "Arithmetic"), strength: 1, contextId: null, version: 1, supersedes: null }]);
    expect(resolver.counts.edges).toBe(1);
    expect(resolver.counts.concepts).toBe(2);
  });

  it("duplicate REQUIRES edge is skipped and recorded (edges not bumped)", async () => {
    const { store, resolver } = makeResolver();
    const dep: RawDependency = { fromName: "Algebra", toName: "Arithmetic", classification: "REQUIRES" };
    await resolver.persistDependency(dep);
    await resolver.persistDependency(dep);

    expect(store.dependency).toHaveLength(1);
    expect(resolver.counts.edges).toBe(1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);
    expect(resolver.omissions.find((o) => o.kind === "duplicate-skipped")!.reason).toBe("REQUIRES edge already present");
  });

  it("PART_OF edge is created in the composition graph", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Wheel", toName: "Car", classification: "PART_OF" });

    expect(store.composition).toEqual([{ partId: idOf(store, "Wheel"), wholeId: idOf(store, "Car"), ordinal: null, version: 1 }]);
    expect(resolver.counts.edges).toBe(1);
  });

  it("duplicate PART_OF edge is skipped", async () => {
    const { store, resolver } = makeResolver();
    const dep: RawDependency = { fromName: "Wheel", toName: "Car", classification: "PART_OF" };
    await resolver.persistDependency(dep);
    await resolver.persistDependency(dep);

    expect(store.composition).toHaveLength(1);
    expect(resolver.counts.edges).toBe(1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);
    expect(resolver.omissions.find((o) => o.kind === "duplicate-skipped")!.reason).toBe("PART_OF edge already present");
  });

  it("REINFORCEMENT edge carries an explicit type", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Waves", toName: "Sound", classification: "REINFORCEMENT", type: "ANALOGOUS_TO" });

    expect(store.reinforcement).toEqual([{ fromId: idOf(store, "Waves"), toId: idOf(store, "Sound"), type: "ANALOGOUS_TO", strength: 1, earned: false, contextId: null, version: 1 }]);
    expect(resolver.counts.edges).toBe(1);
  });

  it("REINFORCEMENT edge defaults its type to REINFORCES when none is given (`?? REINFORCES`)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Speed", toName: "Velocity", classification: "REINFORCEMENT" });

    expect(store.reinforcement[0].type).toBe("REINFORCES");
  });

  it("duplicate REINFORCEMENT edge is skipped", async () => {
    const { store, resolver } = makeResolver();
    const dep: RawDependency = { fromName: "Speed", toName: "Velocity", classification: "REINFORCEMENT" };
    await resolver.persistDependency(dep);
    await resolver.persistDependency(dep);

    expect(store.reinforcement).toHaveLength(1);
    expect(resolver.counts.edges).toBe(1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);
    expect(resolver.omissions.find((o) => o.kind === "duplicate-skipped")!.reason).toBe("REINFORCEMENT edge already present");
  });
});

// ─────────────────────────────── persistAsset ───────────────────────────────
describe("Resolver.persistAsset", () => {
  it("persists a MACHINE_PROPOSED asset linked to its resolved concept with a fresh context", async () => {
    const { store, resolver } = makeResolver();
    const raw: RawAsset = { kind: "ANALOGY", conceptName: "Electricity", payload: { a: 1, breakdownPoint: "y" } };

    await resolver.persistAsset(raw, chunk());

    expect(store.assets).toHaveLength(1);
    const a = store.assets[0];
    expect(typeof a.id).toBe("string");
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.kind).toBe("ANALOGY");
    expect(a.conceptId).toBe(idOf(store, "Electricity"));
    expect(a.statementId).toBeNull();
    expect(a.payload).toEqual({ a: 1, breakdownPoint: "y" });
    expect(a.contextId).toBe("ctx_" + JSON.stringify({}));
    expect(a.trustLevel).toBe("MACHINE_PROPOSED");
    expect(a.scope).toBe("PUBLIC");
    expect(a.version).toBe(1);
    expect(a.supersedes).toBeNull();
    expect(resolver.counts.assets).toBe(1);
  });

  it("an identical asset (same kind + payload) for the concept is skipped and recorded", async () => {
    const { store, resolver } = makeResolver();
    const raw: RawAsset = { kind: "MISCONCEPTION", conceptName: "Inertia", payload: { text: "heavier falls faster" } };
    await resolver.persistAsset(raw, chunk());
    await resolver.persistAsset(raw, chunk());

    expect(store.assets).toHaveLength(1);
    expect(resolver.counts.assets).toBe(1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);
    expect(resolver.omissions.find((o) => o.kind === "duplicate-skipped")!.reason).toBe("identical teaching asset already present for this concept");
  });

  it("same concept but DIFFERENT payload is NOT a duplicate (both assets kept, one concept)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistAsset({ kind: "ANALOGY", conceptName: "Force", payload: { v: 1, breakdownPoint: "b" } }, chunk());
    await resolver.persistAsset({ kind: "ANALOGY", conceptName: "Force", payload: { v: 2, breakdownPoint: "b" } }, chunk());

    expect(store.assets).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
    expect(resolver.counts.concepts).toBe(1); // cache hit on the second resolve
  });
});

// ─────────────────────────────── persistItem ───────────────────────────────
describe("Resolver.persistItem — routed through buildItem's validation gate", () => {
  it("a valid MCQ is persisted MACHINE_PROPOSED and linked PRIMARY to its concept", async () => {
    const { store, resolver } = makeResolver();
    const raw: RawItemArg = {
      kind: "MCQ",
      conceptName: "Fractions",
      prompt: "What is 1/2 + 1/2?",
      payload: { options: [{ text: "1", correct: true }, { text: "2", correct: false }] },
    };

    await resolver.persistItem(raw);

    expect(store.items).toHaveLength(1);
    const item = store.items[0];
    expect(item.kind).toBe("MCQ");
    expect(item.prompt).toBe("What is 1/2 + 1/2?");
    expect(item.payload).toEqual(raw.payload);
    expect(item.contextId).toBe("ctx_" + JSON.stringify({}));
    expect(item.trustLevel).toBe("MACHINE_PROPOSED");
    expect(item.scope).toBe("PUBLIC");
    expect(item.version).toBe(1);
    expect(item.supersedes).toBeNull();

    expect(store.itemConcepts).toEqual([{ itemId: item.id, conceptId: idOf(store, "Fractions"), role: "PRIMARY", bloom: null }]);
    expect(resolver.counts.items).toBe(1);
  });

  it("an identical item (same kind + prompt) for the concept is skipped before build", async () => {
    const { store, resolver } = makeResolver();
    const raw: RawItemArg = {
      kind: "MCQ",
      conceptName: "Fractions",
      prompt: "What is 1/2 + 1/2?",
      payload: { options: [{ text: "1", correct: true }, { text: "2", correct: false }] },
    };
    await resolver.persistItem(raw);
    await resolver.persistItem(raw);

    expect(store.items).toHaveLength(1);
    expect(store.itemConcepts).toHaveLength(1);
    expect(resolver.counts.items).toBe(1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);
    expect(resolver.omissions.find((o) => o.kind === "duplicate-skipped")!.reason).toBe("identical assessment item already present for this concept");
  });

  it("a malformed MCQ (two correct options) is rejected by buildItem → item-rejected omission, nothing persisted", async () => {
    const { store, resolver } = makeResolver();
    const raw: RawItemArg = {
      kind: "MCQ",
      conceptName: "Geometry",
      prompt: "Pick two correct",
      payload: { options: [{ text: "a", correct: true }, { text: "b", correct: true }] },
    };

    await resolver.persistItem(raw);

    expect(store.items).toHaveLength(0);
    expect(store.itemConcepts).toHaveLength(0);
    expect(resolver.counts.items).toBe(0);
    expect(resolver.counts.concepts).toBe(1); // the concept was resolved before the gate rejected the item

    const om = resolver.omissions.find((o) => o.kind === "item-rejected");
    expect(om).toBeDefined();
    expect(om!.stage).toBe("validate");
    expect(om!.reason).toBe("V2:discard — MCQ_NEEDS_EXACTLY_ONE_CORRECT");
    expect(om!.data).toEqual({ kind: "MCQ", concept: "Geometry", prompt: "Pick two correct" });
  });
});

// ─────────────────────────────── scope propagation (default param + explicit tenant) ───────────────────────────────
describe("Resolver — scope", () => {
  it("an explicit tenant scope flows to every minted concept, statement and asset", async () => {
    const { store, resolver } = makeResolver("tenant:acme");

    await resolver.persistStatement(stmt({ subject: "Alpha", predicate: "beats", object: "Beta" }), chunk());
    await resolver.persistAsset({ kind: "ANALOGY", conceptName: "Alpha", payload: { breakdownPoint: "z" } }, chunk());

    expect(store.statements[0].scope).toBe("tenant:acme");
    expect(store.bySlug.get("alpha")!.scope).toBe("tenant:acme");
    expect(store.assets[0].scope).toBe("tenant:acme");
  });
});
