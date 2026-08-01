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
import { slugify } from "@/server/knowledge/ids";
import { pass, type ValidationResult } from "@/server/knowledge/validators";

/**
 * resolve.mut.test.ts — mutation-killing companion to resolve.test.ts.
 *
 * Each test below pins the EXACT behaviour a surviving Stryker mutant would change, so that the
 * mutated source fails at least one assertion. The sole faked I/O edge is the injected
 * KnowledgeStore, kept realistic (in-memory round-trip so idempotency/dedup are real). Two narrow
 * spies are added — a `resolveSlug` call counter and a `statementsForSubject` argument log — because
 * two mutants (the resolveConcept cache-key normalisation and the `if (subjectId)` dedup guard) are
 * observable ONLY as a difference in which store method is invoked, not in the persisted rows.
 */

class SpyStore {
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

  // ── spies (the only non-realistic addition; they observe, they don't fabricate) ──
  resolveSlugCalls = 0;
  readonly subjectQueryArgs: unknown[] = [];

  seed(concept: Concept): void {
    this.bySlug.set(concept.slug, concept);
    this.byId.set(concept.id, concept);
  }

  async resolveSlug(slug: string, _scope?: Scope): Promise<SlugResolution> {
    this.resolveSlugCalls++;
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
    this.subjectQueryArgs.push(subjectId);
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

function makeResolver(scope?: Scope): { store: SpyStore; resolver: Resolver } {
  const store = new SpyStore();
  const asStore = store as unknown as KnowledgeStore;
  const resolver = scope ? new Resolver(asStore, "src_1", "model_1", scope) : new Resolver(asStore, "src_1", "model_1");
  return { store, resolver };
}

function stmt(over: Partial<RawStatement> = {}): RawStatement {
  return { form: "SPO", kind: "FACT", text: "default text", quote: "q", structure: {}, ...over };
}
function chunk(over: Partial<Chunk> = {}): Chunk {
  return { id: "chunk_1", sourceId: "src_1", locator: { page: 1, range: [0, 10] }, text: "passage", ordinal: 0, ...over };
}
const idOf = (store: SpyStore, name: string): string => {
  const c = store.bySlug.get(slugify(name));
  if (!c) throw new Error(`no concept for ${name}`);
  return c.id;
};

// ─────────────────── nameIn / objectNameOf trimming (L40:46, L46:11) ───────────────────
describe("resolve.mut — name trimming", () => {
  it("nameIn trims the structure value it returns, so the minted concept name is exactly 'Cell' (L40:46)", async () => {
    // Non-SPO form + only structure.subject → routes through nameIn's return value `v.trim()`.
    const { store, resolver } = makeResolver();
    await resolver.persistStatement(
      stmt({ form: "DEFINITIONAL", kind: "FACT", text: "A cell is the unit of life.", structure: { subject: "  Cell  " } }),
      chunk(),
    );
    const subjectId = store.statements[0].subjectId!;
    expect(subjectId).not.toBeNull();
    // Mutating `v.trim()` (return) → `v` would mint the concept with a padded name.
    expect(store.byId.get(subjectId)!.name).toBe("Cell");
    expect(store.byId.get(subjectId)!.slug).toBe("cell");
  });

  it("objectNameOf trims the top-level object, so the object concept name is exactly 'Light' (L46:11)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistStatement(
      stmt({ form: "SPO", kind: "FACT", text: "The sun emits light.", subject: "Sun", predicate: "emits", object: "  Light  " }),
      chunk(),
    );
    const objectId = store.statements[0].objectId!;
    expect(objectId).not.toBeNull();
    // Mutating `raw.object?.trim()` → `raw.object` would mint the object concept with a padded name.
    expect(store.byId.get(objectId)!.name).toBe("Light");
  });
});

// ─────────────────── skipDuplicate omission stage (L64:34) ───────────────────
describe("resolve.mut — skipDuplicate omission carries stage 'persist' (L64:34)", () => {
  it("a duplicate REQUIRES edge records an omission whose stage is exactly 'persist'", async () => {
    const { resolver } = makeResolver();
    const dep: RawDependency = { fromName: "Algebra", toName: "Arithmetic", classification: "REQUIRES" };
    await resolver.persistDependency(dep);
    await resolver.persistDependency(dep);
    const om = resolver.omissions.find((o) => o.kind === "duplicate-skipped")!;
    expect(om).toBeDefined();
    expect(om.stage).toBe("persist"); // mutating the "persist" literal to "" fails here
  });
});

// ─────────────────── resolveConcept cache-key normalisation (L70:17) ───────────────────
describe("resolve.mut — resolveConcept cache key is trim+lowercased (L70:17)", () => {
  it("'Energy' then 'energy' hit the same cache key → resolveSlug is called only ONCE", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistAsset({ kind: "ANALOGY", conceptName: "Energy", payload: { a: 1 } }, chunk());
    await resolver.persistAsset({ kind: "ANALOGY", conceptName: "energy", payload: { a: 2 } }, chunk());
    // Original key `name.trim().toLowerCase()` makes 'Energy' and 'energy' collide → 2nd is a cache
    // hit → no 2nd resolveSlug. Mutating the key to `name` (raw) makes them distinct keys → a 2nd
    // resolveSlug lookup. Concept count stays 1 either way (slug dedup), so the call count is the tell.
    expect(store.resolveSlugCalls).toBe(1);
    expect(resolver.counts.concepts).toBe(1);
    expect(store.assets).toHaveLength(2);
  });
});

// ─────────────────── the `if (subjectId)` dedup guard (L110:9) ───────────────────
describe("resolve.mut — dedup lookup is skipped when there is no subject (L110:9)", () => {
  it("an unresolved-subject statement never triggers statementsForSubject", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistStatement(stmt({ form: "SPO", kind: "FACT", text: "Orphan.", structure: {} }), chunk());
    expect(store.statements).toHaveLength(1);
    expect(store.statements[0].subjectId).toBeNull();
    // Mutating `if (subjectId)` → `if (true)` would query statementsForSubject(undefined).
    expect(store.subjectQueryArgs).toEqual([]);
  });
});

// ─────────────────── SPO-vs-nonSPO dedup branch selector (L113:9) + non-SPO branch (L115) ───────────────────
describe("resolve.mut — dedup branch selection by form", () => {
  it("two same-subject same-text statements of DIFFERENT non-SPO forms are BOTH kept (L113:9, L115:13 cond & logical)", async () => {
    const { store, resolver } = makeResolver();
    const text = "Same aboutness text.";
    await resolver.persistStatement(stmt({ form: "DEFINITIONAL", kind: "FACT", text, structure: { subject: "Heat" } }), chunk());
    await resolver.persistStatement(stmt({ form: "CAUSAL", kind: "PRINCIPLE", text, structure: { subject: "Heat" } }), chunk());
    // Real path: non-SPO branch `s.form === raw.form && s.text === raw.text` → forms differ → NOT a dup.
    //  - L113:9 `raw.form === "SPO"` → true would force the SPO branch (predicate/text/object) → dedup.
    //  - L115:13 `s.form === raw.form` → true would dedup.
    //  - L115:13 `&&` → `||` would dedup on text alone.
    expect(store.statements).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("two same-subject SAME-form statements with DIFFERENT text are BOTH kept (L115:36)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistStatement(stmt({ form: "DEFINITIONAL", kind: "FACT", text: "Text one.", structure: { subject: "Vector" } }), chunk());
    await resolver.persistStatement(stmt({ form: "DEFINITIONAL", kind: "FACT", text: "Text two.", structure: { subject: "Vector" } }), chunk());
    // Mutating `s.text === raw.text` → true would dedup two distinct statements.
    expect(store.statements).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });
});

// ─────────────────── SPO dedup predicate/text/object comparisons (L114) ───────────────────
describe("resolve.mut — SPO dedup comparisons", () => {
  it("same subject+text+object but DIFFERENT predicate is NOT a dup (L114:13 cond -> true)", async () => {
    const { store, resolver } = makeResolver();
    const text = "Identical text.";
    await resolver.persistStatement(stmt({ subject: "Sun", predicate: "emits", text }), chunk());
    await resolver.persistStatement(stmt({ subject: "Sun", predicate: "absorbs", text }), chunk());
    // `(s.predicate ?? "") === (raw.predicate ?? "")` → true would collapse these.
    expect(store.statements).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("same subject+predicate+object but DIFFERENT text is NOT a dup (L114:62 cond, L114:13 logical)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistStatement(stmt({ subject: "Sun", predicate: "emits", text: "Text A." }), chunk());
    await resolver.persistStatement(stmt({ subject: "Sun", predicate: "emits", text: "Text B." }), chunk());
    //  - L114:62 `s.text === raw.text` → true would dedup.
    //  - L114:13 `&&` → `||` makes `predEq || (textEq && objEq)` = true (predEq true) → dedup.
    expect(store.statements).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("same subject+predicate+text but DIFFERENT objectLit is NOT a dup (L114:123 cond -> true)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistStatement(stmt({ subject: "Water", predicate: "boils_at", objectLit: "100C", text: "T." }), chunk());
    await resolver.persistStatement(stmt({ subject: "Water", predicate: "boils_at", objectLit: "0C", text: "T." }), chunk());
    // `(s.objectLit ?? null) === (raw.objectLit ?? null)` → true would collapse "100C" and "0C".
    expect(store.statements).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("a no-predicate no-object SPO dedups against a stored NULL-predicate statement → the `?? \"\"` defaults fire (L114:29, L114:55)", async () => {
    const { store, resolver } = makeResolver();
    const text = "Gravity is a fundamental force.";
    // First: a non-SPO statement about Gravity → stored predicate is NULL, objectLit NULL.
    const firstId = await resolver.persistStatement(stmt({ form: "DEFINITIONAL", kind: "FACT", text, structure: { subject: "Gravity" } }), chunk());
    expect(store.statements[0].predicate).toBeNull();
    // Second: an SPO about Gravity with NO predicate, NO object, SAME text. The SPO dedup branch
    // compares `(s.predicate ?? "") === (raw.predicate ?? "")` = "" === "" → matches → collapses.
    const secondId = await resolver.persistStatement(stmt({ form: "SPO", kind: "FACT", text, subject: "Gravity" }), chunk({ id: "c2" }));
    expect(secondId).toBe(firstId);
    expect(store.statements).toHaveLength(1);
    expect(resolver.counts.duplicatesSkipped).toBe(1);
    // L114:29 `s.predicate ?? ""` → `?? "Stryker was here!"` : "Stryker was here!" !== "" → no dedup → 2 rows.
    // L114:55 `raw.predicate ?? ""` → `?? "Stryker was here!"` : "" !== "Stryker was here!" → no dedup → 2 rows.
  });
});

// ─────────────────── persistStatement dedup omission data (L119) ───────────────────
describe("resolve.mut — duplicate-statement omission data (L119:183, L119:207)", () => {
  it("records exact { form, text: text.slice(0,160) } for a long-text SPO duplicate", async () => {
    const { resolver } = makeResolver();
    const text = "y".repeat(200);
    const raw = stmt({ subject: "Sun", predicate: "emits", text });
    await resolver.persistStatement(raw, chunk({ id: "c1" }));
    await resolver.persistStatement(raw, chunk({ id: "c2" }));
    const om = resolver.omissions.find((o) => o.kind === "duplicate-skipped")!;
    expect(om).toBeDefined();
    // L119:183 `{ form, text }` → `{}` fails; L119:207 `raw.text.slice(0,160)` → `raw.text` gives 200 chars.
    expect(om.data).toEqual({ form: "SPO", text: "y".repeat(160) });
  });
});

// ─────────────────── persistDependency: REQUIRES edge dedup (L163) ───────────────────
describe("resolve.mut — REQUIRES dedup comparisons + data (L163)", () => {
  it("same-from / DIFFERENT-to REQUIRES is a distinct edge (L163:83 toId, L163:60 logical)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Algebra", toName: "Arithmetic", classification: "REQUIRES" });
    await resolver.persistDependency({ fromName: "Algebra", toName: "Calculus", classification: "REQUIRES" });
    // `e.fromId === fromId && e.toId === toId`: toId→true, or &&→|| would treat A→Calculus as a dup.
    expect(store.dependency).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("DIFFERENT-from / same-to REQUIRES is a distinct edge (L163:60 fromId -> true)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Algebra", toName: "Arithmetic", classification: "REQUIRES" });
    await resolver.persistDependency({ fromName: "Geometry", toName: "Arithmetic", classification: "REQUIRES" });
    expect(store.dependency).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("exact-duplicate REQUIRES records skip data { fromId, toId } (L163:155)", async () => {
    const { store, resolver } = makeResolver();
    const dep: RawDependency = { fromName: "Algebra", toName: "Arithmetic", classification: "REQUIRES" };
    await resolver.persistDependency(dep);
    await resolver.persistDependency(dep);
    const om = resolver.omissions.find((o) => o.kind === "duplicate-skipped")!;
    expect(om.data).toEqual({ fromId: idOf(store, "Algebra"), toId: idOf(store, "Arithmetic") });
  });
});

// ─────────────────── persistDependency: PART_OF edge dedup (L167) ───────────────────
describe("resolve.mut — PART_OF dedup comparisons + data (L167)", () => {
  it("same-part / DIFFERENT-whole PART_OF is a distinct edge (L167:84 wholeId, L167:61 logical)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Wheel", toName: "Car", classification: "PART_OF" });
    await resolver.persistDependency({ fromName: "Wheel", toName: "Bike", classification: "PART_OF" });
    expect(store.composition).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("DIFFERENT-part / same-whole PART_OF is a distinct edge (L167:61 partId -> true)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Wheel", toName: "Car", classification: "PART_OF" });
    await resolver.persistDependency({ fromName: "Engine", toName: "Car", classification: "PART_OF" });
    expect(store.composition).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("exact-duplicate PART_OF records skip data { fromId, toId } (L167:158)", async () => {
    const { store, resolver } = makeResolver();
    const dep: RawDependency = { fromName: "Wheel", toName: "Car", classification: "PART_OF" };
    await resolver.persistDependency(dep);
    await resolver.persistDependency(dep);
    const om = resolver.omissions.find((o) => o.kind === "duplicate-skipped")!;
    expect(om.data).toEqual({ fromId: idOf(store, "Wheel"), toId: idOf(store, "Car") });
  });
});

// ─────────────────── persistDependency: REINFORCEMENT edge dedup (L171) ───────────────────
describe("resolve.mut — REINFORCEMENT dedup comparisons + data (L171)", () => {
  it("same-from / DIFFERENT-to REINFORCEMENT is a distinct edge (L171:86 toId, L171:63 logical)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Speed", toName: "Velocity", classification: "REINFORCEMENT" });
    await resolver.persistDependency({ fromName: "Speed", toName: "Acceleration", classification: "REINFORCEMENT" });
    expect(store.reinforcement).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("DIFFERENT-from / same-to REINFORCEMENT is a distinct edge (L171:63 fromId -> true)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistDependency({ fromName: "Speed", toName: "Velocity", classification: "REINFORCEMENT" });
    await resolver.persistDependency({ fromName: "Force", toName: "Velocity", classification: "REINFORCEMENT" });
    expect(store.reinforcement).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("exact-duplicate REINFORCEMENT records skip data { fromId, toId } (L171:163)", async () => {
    const { store, resolver } = makeResolver();
    const dep: RawDependency = { fromName: "Speed", toName: "Velocity", classification: "REINFORCEMENT" };
    await resolver.persistDependency(dep);
    await resolver.persistDependency(dep);
    const om = resolver.omissions.find((o) => o.kind === "duplicate-skipped")!;
    expect(om.data).toEqual({ fromId: idOf(store, "Speed"), toId: idOf(store, "Velocity") });
  });
});

// ─────────────────── persistAsset dedup (L182:94, L183:87) ───────────────────
describe("resolve.mut — asset dedup by kind (L182:94) + skip data (L183:87)", () => {
  it("same concept + same payload but DIFFERENT kind is NOT a duplicate asset", async () => {
    const { store, resolver } = makeResolver();
    const payload = { text: "same" };
    await resolver.persistAsset({ kind: "ANALOGY", conceptName: "Inertia", payload }, chunk());
    await resolver.persistAsset({ kind: "MISCONCEPTION", conceptName: "Inertia", payload }, chunk());
    // `a.kind === raw.kind` → true would collapse two different-kind assets that share a payload.
    expect(store.assets).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("an identical asset records skip data { conceptId, kind } (L183:87)", async () => {
    const { store, resolver } = makeResolver();
    const raw: RawAsset = { kind: "MISCONCEPTION", conceptName: "Inertia", payload: { text: "heavier falls faster" } };
    await resolver.persistAsset(raw, chunk());
    await resolver.persistAsset(raw, chunk());
    const om = resolver.omissions.find((o) => o.kind === "duplicate-skipped")!;
    expect(om.data).toEqual({ conceptId: idOf(store, "Inertia"), kind: "MISCONCEPTION" });
  });
});

// ─────────────────── persistItem dedup (L207, L208) ───────────────────
describe("resolve.mut — item dedup by kind+prompt (L207) + skip data (L208)", () => {
  it("same concept + same prompt but DIFFERENT kind is NOT a duplicate item (L207:93 kind cond & logical)", async () => {
    const { store, resolver } = makeResolver();
    const prompt = "Define the term.";
    await resolver.persistItem({ kind: "SHORT", conceptName: "Fractions", prompt, payload: {} } as RawItemArg);
    await resolver.persistItem({
      kind: "MCQ",
      conceptName: "Fractions",
      prompt,
      payload: { options: [{ text: "a", correct: true }, { text: "b", correct: false }] },
    } as RawItemArg);
    // `i.kind === raw.kind` → true, or &&→||, would collapse the MCQ into the SHORT on prompt alone.
    expect(store.items).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("same concept + same kind but DIFFERENT prompt is NOT a duplicate item (L207:116 prompt -> true)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistItem({ kind: "SHORT", conceptName: "Fractions", prompt: "Prompt one?", payload: {} } as RawItemArg);
    await resolver.persistItem({ kind: "SHORT", conceptName: "Fractions", prompt: "Prompt two?", payload: {} } as RawItemArg);
    expect(store.items).toHaveLength(2);
    expect(resolver.counts.duplicatesSkipped).toBe(0);
  });

  it("an identical item records skip data { conceptId, kind, prompt: prompt.slice(0,120) } (L208:88, L208:125)", async () => {
    const { store, resolver } = makeResolver();
    const prompt = "z".repeat(200);
    const raw = { kind: "SHORT", conceptName: "Fractions", prompt, payload: {} } as RawItemArg;
    await resolver.persistItem(raw);
    await resolver.persistItem(raw);
    const om = resolver.omissions.find((o) => o.kind === "duplicate-skipped")!;
    // L208:88 `{...}` → `{}` fails; L208:125 `raw.prompt.slice(0,120)` → `raw.prompt` gives 200 chars.
    expect(om.data).toEqual({ conceptId: idOf(store, "Fractions"), kind: "SHORT", prompt: "z".repeat(120) });
  });
});

// ─────────────────── persistItem rejection gate (L216:9, L221:67) ───────────────────
describe("resolve.mut — buildItem rejection gate", () => {
  it("a malformed MCQ (two correct) is NOT persisted — the reject branch runs (L216:9 -> false)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistItem({
      kind: "MCQ",
      conceptName: "Geometry",
      prompt: "Pick two correct",
      payload: { options: [{ text: "a", correct: true }, { text: "b", correct: true }] },
    } as RawItemArg);
    // Mutating the whole `if (outcome === "reject" || outcome === "discard")` to false would persist it.
    expect(store.items).toHaveLength(0);
    expect(store.itemConcepts).toHaveLength(0);
    expect(resolver.counts.items).toBe(0);
    expect(resolver.omissions.find((o) => o.kind === "item-rejected")).toBeDefined();
  });

  it("the item-rejected omission slices the prompt to 120 chars (L221:67)", async () => {
    const { resolver } = makeResolver();
    const prompt = "q".repeat(200);
    await resolver.persistItem({
      kind: "MCQ",
      conceptName: "Geometry",
      prompt,
      payload: { options: [{ text: "a", correct: true }, { text: "b", correct: true }] },
    } as RawItemArg);
    const om = resolver.omissions.find((o) => o.kind === "item-rejected")!;
    expect(om).toBeDefined();
    // Mutating `raw.prompt.slice(0,120)` → `raw.prompt` would store the full 200-char prompt.
    expect(om.data).toEqual({ kind: "MCQ", concept: "Geometry", prompt: "q".repeat(120) });
    expect(om.reason).toBe("V2:discard — MCQ_NEEDS_EXACTLY_ONE_CORRECT");
  });

  it("an alternate discard reason (too-few options) is recorded verbatim — a second buildItem reject path (L216/L220)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistItem({
      kind: "MCQ",
      conceptName: "Optics",
      prompt: "One option only",
      payload: { options: [{ text: "only", correct: true }] },
    } as RawItemArg);
    expect(store.items).toHaveLength(0);
    const om = resolver.omissions.find((o) => o.kind === "item-rejected")!;
    expect(om).toBeDefined();
    // Real path: validateItemPayload → { outcome: "discard", reason: "MCQ_NEEDS_AT_LEAST_TWO_OPTIONS" }.
    // The reason is ALWAYS truthy on a reject/discard, so the `: ""` fallback (L220:113) is unreachable —
    // this pins the composed reason exactly, and locks that the "discard" arm of L216 gates the item out.
    expect(om.reason).toBe("V2:discard — MCQ_NEEDS_AT_LEAST_TWO_OPTIONS");
  });
});

// ─────────────────── persistStatement trust/validation branch (§14 / §26.2) ───────────────────
// The pre-existing suite never passes a `validation` array, so the `clean` ternary (both arms) and
// the default-empty `validation: ValidationResult[] = []` (L92:92) went unexercised. These pin the
// EXACT trust fields produced on each side of `validation.length > 0 && validatorsPass(validation)`.
describe("resolve.mut — trust assignment from validation results", () => {
  it("no validation arg → statement lands MACHINE_PROPOSED with empty methods (default-[] semantics, L92:92)", async () => {
    const { store, resolver } = makeResolver();
    await resolver.persistStatement(stmt({ subject: "Photon", predicate: "carries", text: "A photon carries energy." }), chunk());
    const s = store.statements[0];
    // clean = ([].length > 0) && … = false → no trust override. Mutating the default to a junk array
    // still fails validatorsPass, so this asserts the observable ceiling either way: MACHINE_PROPOSED.
    expect(s.trustLevel).toBe("MACHINE_PROPOSED");
    expect(s.validationMethods).toEqual([]);
    expect(s.independentSourceCount).toBe(0);
  });

  it("all-passing validation → AUTO_VALIDATED, methods mapped from validators, source count 1 (clean=true arm)", async () => {
    const { store, resolver } = makeResolver();
    const validation: ValidationResult[] = [pass("V3"), pass("V4"), pass("V5")];
    await resolver.persistStatement(stmt({ subject: "Photon", predicate: "carries", text: "A photon carries energy." }), chunk(), validation);
    const s = store.statements[0];
    expect(s.trustLevel).toBe("AUTO_VALIDATED");
    expect(s.validationMethods).toEqual(["V3", "V4", "V5"]); // validation.map((v) => v.validator)
    expect(s.independentSourceCount).toBe(1);
  });

  it("a non-passing validation (one flag) keeps MACHINE_PROPOSED — validatorsPass gates the `&&` (clean=false arm)", async () => {
    const { store, resolver } = makeResolver();
    const validation: ValidationResult[] = [pass("V3"), { validator: "V5", outcome: "flag" }];
    await resolver.persistStatement(stmt({ subject: "Photon", predicate: "carries", text: "A photon carries energy." }), chunk(), validation);
    const s = store.statements[0];
    // length > 0 is true here, so ONLY validatorsPass distinguishes the arms → the non-"pass" flag
    // forces clean=false → no AUTO_VALIDATED, no mapped methods.
    expect(s.trustLevel).toBe("MACHINE_PROPOSED");
    expect(s.validationMethods).toEqual([]);
    expect(s.independentSourceCount).toBe(0);
  });
});
