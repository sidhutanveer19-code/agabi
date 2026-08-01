import { describe, it, expect } from "vitest";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { describeConformance } from "@/server/knowledge/store/conformance";

/**
 * Mutation kills for `conformance.ts` (§29 conformance suite).
 *
 * `conformance.ts` is itself a body of tests (`describeConformance`), so Stryker mutates its
 * assertions and its call arguments. The memory conformance run in `conformance.test.ts`
 * already kills every EXACT-assertion mutant (a `toEqual`/`toBe` whose expected value is
 * flipped fails immediately). What survives are the mutations the *reference* memory store is
 * too permissive to expose:
 *
 *   · a scope/id/slug/subject argument flipped to "" — the memory store returns PUBLIC rows at
 *     ANY scope, and every read is empty on a fresh store, so `store.method("")` gives the same
 *     answer as `store.method("PUBLIC")`. Nothing in the suite notices the flip.
 *   · a whole write-argument object flipped to `{}` — the row is still written under a derived
 *     id and the suite only asserts the id round-trips, never the degenerate payload.
 *   · a `.sort()` dropped from a helper — the memory store happens to return rows already in the
 *     asserted order, so the missing sort is invisible.
 *
 * The conformance suite is contractually run against ANY KnowledgeStore (that is the whole point
 * of the seam — see conformance.ts header). So the kill is to run the identical suite against a
 * store that is STRICTER about degenerate inputs and returns rows in a NON-sorted order. Every
 * real call in the suite passes through untouched (real ids, real scopes, populated objects);
 * only a mutation-injected "" / {} argument, or a mutation-dropped sort, trips it. That turns the
 * surviving argument/sort mutations into failures — exactly killing them — while the unmutated
 * run stays green.
 *
 * This file imports NO database (`conformance.test.ts` pulls in prisma); it drives the pure
 * in-memory reference only, so it runs anywhere the memory suite does.
 */

/** A write argument object is only ever `{}` because an `ObjectLiteral` mutation emptied it. */
const emptyObject = (x: unknown): boolean =>
  !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x as object).length === 0;

/**
 * The reference memory store, wrapped so that a degenerate argument a mutation would inject —
 * an empty-string scope/id/slug/subject, or an emptied `{}` write payload — throws instead of
 * being silently absorbed, and reads come back in an order the suite must re-sort. Every method
 * a real conformance call uses delegates unchanged, so the unmutated suite is identical to the
 * memory run; only mutation-injected sentinels diverge.
 */
function createStrictStore(): KnowledgeStore {
  const base = createMemoryStore();
  const bad = (where: string): never => {
    throw new Error(`strict conformance store: refused degenerate argument in ${where}`);
  };

  return {
    ...base,

    // ── reads: reject an "" scope/id/slug/subject a StringLiteral mutation would inject ──
    async listConcepts(scope) {
      if ((scope as unknown) === "") bad("listConcepts(scope)");
      // Return DESCENDING by id so the suite's `ids = cs => cs.map(c => c.id).sort()` helper is
      // only correct because of its `.sort()`. Drop that sort (the mutation) and the order is wrong.
      const rows = await base.listConcepts(scope);
      return [...rows].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    },
    async getConcept(id, scope) {
      if ((id as unknown) === "") bad("getConcept(id)");
      if ((scope as unknown) === "") bad("getConcept(scope)");
      return base.getConcept(id, scope);
    },
    async getContext(id) {
      if ((id as unknown) === "") bad("getContext(id)");
      return base.getContext(id);
    },
    async resolveSlug(slug, scope) {
      if ((slug as unknown) === "") bad("resolveSlug(slug)");
      if ((scope as unknown) === "") bad("resolveSlug(scope)");
      return base.resolveSlug(slug, scope);
    },
    async statementsForSubject(subjectId, scope, policy) {
      if ((subjectId as unknown) === "") bad("statementsForSubject(subjectId)");
      if ((scope as unknown) === "") bad("statementsForSubject(scope)");
      // Reverse the admitted rows so `research.map(s => s.trustLevel).sort()` is only correct
      // because of its `.sort()`; dropping that sort (the mutation) yields the reversed order.
      const rows = await base.statementsForSubject(subjectId, scope, policy);
      return [...rows].reverse();
    },
    async getStatement(id, scope, policy) {
      if ((id as unknown) === "") bad("getStatement(id)");
      if ((scope as unknown) === "") bad("getStatement(scope)");
      return base.getStatement(id, scope, policy);
    },
    async provenanceFor(id) {
      if ((id as unknown) === "") bad("provenanceFor(id)");
      return base.provenanceFor(id);
    },
    async searchChunks(query, opts) {
      if ((query as unknown) === "") bad("searchChunks(query)");
      return base.searchChunks(query, opts);
    },
    async getSource(id) {
      if ((id as unknown) === "") bad("getSource(id)");
      return base.getSource(id);
    },
    async getSourceChunk(id) {
      if ((id as unknown) === "") bad("getSourceChunk(id)");
      return base.getSourceChunk(id);
    },
    async chunksForSource(sourceId) {
      if ((sourceId as unknown) === "") bad("chunksForSource(sourceId)");
      return base.chunksForSource(sourceId);
    },
    async reviewEventsFor(targetKind, targetId) {
      if (targetKind === "" || targetId === "") bad("reviewEventsFor()");
      return base.reviewEventsFor(targetKind, targetId);
    },
    async assetsForConcept(conceptId, scope, policy) {
      if ((conceptId as unknown) === "") bad("assetsForConcept(conceptId)");
      if ((scope as unknown) === "") bad("assetsForConcept(scope)");
      return base.assetsForConcept(conceptId, scope, policy);
    },
    async itemsForConcept(conceptId, scope, policy) {
      if ((conceptId as unknown) === "") bad("itemsForConcept(conceptId)");
      if ((scope as unknown) === "") bad("itemsForConcept(scope)");
      return base.itemsForConcept(conceptId, scope, policy);
    },
    async mappingsForConcept(conceptId) {
      if ((conceptId as unknown) === "") bad("mappingsForConcept(conceptId)");
      return base.mappingsForConcept(conceptId);
    },
    async mappingsUnderNode(programNodeId) {
      if ((programNodeId as unknown) === "") bad("mappingsUnderNode(programNodeId)");
      return base.mappingsUnderNode(programNodeId);
    },
    async getClosure(conceptId, releaseId) {
      if (conceptId === "" || releaseId === "") bad("getClosure()");
      return base.getClosure(conceptId, releaseId);
    },
    async releaseMembersOf(releaseId) {
      if ((releaseId as unknown) === "") bad("releaseMembersOf(releaseId)");
      return base.releaseMembersOf(releaseId);
    },

    // ── writes: reject a whole-payload `{}` an ObjectLiteral mutation would inject ──
    async putConcept(concept) {
      if (emptyObject(concept)) bad("putConcept()");
      return base.putConcept(concept);
    },
    async putConceptAlias(alias) {
      if (emptyObject(alias)) bad("putConceptAlias()");
      return base.putConceptAlias(alias);
    },
    async putConceptTag(tag) {
      if (emptyObject(tag)) bad("putConceptTag()");
      return base.putConceptTag(tag);
    },
    async putStatement(statement) {
      if (emptyObject(statement)) bad("putStatement()");
      return base.putStatement(statement);
    },
    async putProvenance(provenance) {
      if (emptyObject(provenance)) bad("putProvenance()");
      return base.putProvenance(provenance);
    },
    async putSource(source) {
      if (emptyObject(source)) bad("putSource()");
      return base.putSource(source);
    },
    async putSourceChunk(chunk) {
      if (emptyObject(chunk)) bad("putSourceChunk()");
      return base.putSourceChunk(chunk);
    },
    async putDependencyEdge(edge) {
      if (emptyObject(edge)) bad("putDependencyEdge()");
      return base.putDependencyEdge(edge);
    },
    async putCompositionEdge(edge) {
      if (emptyObject(edge)) bad("putCompositionEdge()");
      return base.putCompositionEdge(edge);
    },
    async putReinforcementEdge(edge) {
      if (emptyObject(edge)) bad("putReinforcementEdge()");
      return base.putReinforcementEdge(edge);
    },
    async putReviewEvent(event) {
      if (emptyObject(event)) bad("putReviewEvent()");
      return base.putReviewEvent(event);
    },
    async putTeachingAsset(asset) {
      if (emptyObject(asset)) bad("putTeachingAsset()");
      return base.putTeachingAsset(asset);
    },
    async putAssessmentItem(item) {
      if (emptyObject(item)) bad("putAssessmentItem()");
      return base.putAssessmentItem(item);
    },
    async putItemConcept(link) {
      if (emptyObject(link)) bad("putItemConcept()");
      return base.putItemConcept(link);
    },
    async putProgram(program) {
      if (emptyObject(program)) bad("putProgram()");
      return base.putProgram(program);
    },
    async putProgramNode(node) {
      if (emptyObject(node)) bad("putProgramNode()");
      return base.putProgramNode(node);
    },
    async putMapping(mapping) {
      if (emptyObject(mapping)) bad("putMapping()");
      return base.putMapping(mapping);
    },
    async putClosure(entry) {
      if (emptyObject(entry)) bad("putClosure()");
      return base.putClosure(entry);
    },
    async putContext(dimensions) {
      if (emptyObject(dimensions)) bad("putContext(dimensions)");
      return base.putContext(dimensions);
    },
    async putRelease(release, members) {
      if (emptyObject(release)) bad("putRelease(release)");
      return base.putRelease(release, members);
    },
    async commitReview(event, effect) {
      if (emptyObject(event)) bad("commitReview(event)");
      if (emptyObject(effect)) bad("commitReview(effect)");
      return base.commitReview(event, effect);
    },
  };
}

// Run the identical §29 contract against the strict reference store. Unmutated it is byte-for-byte
// the memory run (real ids/scopes/objects flow straight through); a mutation that injects an ""
// argument, an emptied `{}` payload, or drops an order-fixing `.sort()` now fails a real assertion.
describeConformance("memory (strict-argument reference)", createStrictStore);

// Kills L25:11 — `if (reset)` → `false`. A store that ACCUMULATES across cases unless `reset`
// rebuilds it: with reset live, every case sees a fresh store (green); flip the guard to `false`
// and case 2's `putConcept("Chlorophyll")` leaks into case 3's `listConcepts("PUBLIC")`, whose
// `toEqual([pub.id])` then fails on the extra row. So the reset call is load-bearing and pinned.
describe("conformance beforeEach reset is load-bearing", () => {
  let holder = createMemoryStore();
  const makePersistent = (): KnowledgeStore => holder;
  const resetPersistent = async (): Promise<void> => {
    holder = createMemoryStore();
  };
  describeConformance("persistent memory + reset", makePersistent, resetPersistent);

  it("reset actually rebuilds the store between cases (sanity)", async () => {
    holder = createMemoryStore();
    await resetPersistent();
    expect(await holder.listConcepts("PUBLIC")).toEqual([]);
  });
});
