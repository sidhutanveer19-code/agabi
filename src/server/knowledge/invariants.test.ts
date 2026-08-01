import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mintId, slugify } from "@/server/knowledge/ids";
import { canonicalize, contextId } from "@/server/knowledge/context/canonical";
import { buildConcept, rename } from "@/server/knowledge/concept";
import { boundedTraverse, adjacencyFrom, type Edge } from "@/server/knowledge/graph/traverse";
import * as dependency from "@/server/knowledge/graph/dependency";
import * as composition from "@/server/knowledge/graph/composition";
import * as reinforcement from "@/server/knowledge/graph/reinforcement";
import { graphConflicts, wouldConflict } from "@/server/knowledge/graph/conflict";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildStatement } from "@/server/knowledge/statement";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type { DependencyEdge, CompositionEdge, ReinforcementEdge } from "@/server/knowledge/types";

/** Test edge builders — only the fields each graph reads. */
const dep = (fromId: string, toId: string): DependencyEdge => ({ fromId, toId, strength: 1, contextId: null, version: 1, supersedes: null });
const comp = (partId: string, wholeId: string): CompositionEdge => ({ partId, wholeId, ordinal: null, version: 1 });
const rein = (fromId: string, toId: string): ReinforcementEdge => ({ fromId, toId, type: "REINFORCES", strength: 1, earned: false, contextId: null, version: 1 });

describe("knowledge invariants (§29) — data properties, held forever", () => {
  // identity (§29, S11): ids are opaque + immutable; slugs are mutable and never identity.
  describe("identity", () => {
    it("ids are opaque — same name yields different ids (id is not derived from meaning)", () => {
      const a = buildConcept({ name: "Chlorophyll" });
      const b = buildConcept({ name: "Chlorophyll" });
      expect(a.id).not.toBe(b.id);
    });
    it("id is immutable across a rename; only the slug moves", () => {
      const c = buildConcept({ name: "Colour" });
      const after = rename(c, "Color");
      expect(after.concept.id).toBe(c.id); // identity never changes
      expect(after.concept.slug).toBe("color"); // slug is mutable
      expect(after.formerAlias.alias).toBe("colour"); // old slug kept resolving
    });
    it("ids are k-sortable across time (the property §18A.2 chose over UUIDv4)", async () => {
      const early = mintId();
      await new Promise((r) => setTimeout(r, 3));
      const late = mintId();
      expect(early < late).toBe(true);
    });
    it("slugify is deterministic and url-safe", () => {
      expect(slugify("Light Reaction (C3)")).toBe("light-reaction-c3");
    });
  });

  // context-canonical (§29, C5)
  describe("context-canonical", () => {
    it("key order does not change the canonical form or the id", () => {
      expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
      expect(contextId({ a: 1, b: 2 })).toBe(contextId({ b: 2, a: 1 }));
    });
    it("different dimensions hash differently", () => {
      expect(contextId({ jurisdiction: "IN" })).not.toBe(contextId({ jurisdiction: "US" }));
    });
  });

  // dependency-dag / composition-dag (§29, S12 / C2)
  describe("acyclic graphs", () => {
    it("dependency-dag — REQUIRES is acyclic; a cycle is detected", () => {
      expect(dependency.isAcyclic([dep("A", "B"), dep("B", "C")])).toBe(true);
      expect(dependency.isAcyclic([dep("A", "B"), dep("B", "A")])).toBe(false);
    });
    it("dependency — V7 rejects an edge that would close a cycle", () => {
      const g = [dep("A", "B"), dep("B", "C")];
      expect(dependency.wouldViolateAcyclicity(g, "C", "A")).toBe(true); // C requires A closes A→B→C→A
      expect(dependency.wouldViolateAcyclicity(g, "A", "D")).toBe(false);
    });
    it("composition-dag — PART_OF is acyclic; a cycle is detected", () => {
      expect(composition.isAcyclic([comp("leaf", "plant")])).toBe(true);
      expect(composition.isAcyclic([comp("a", "b"), comp("b", "a")])).toBe(false);
    });
    it("dependency learning order puts prerequisites first, deterministically", () => {
      const { order, hasCycle } = dependency.learningOrder([dep("calculus", "algebra"), dep("algebra", "arithmetic")]);
      expect(hasCycle).toBe(false);
      expect(order.indexOf("arithmetic")).toBeLessThan(order.indexOf("algebra"));
      expect(order.indexOf("algebra")).toBeLessThan(order.indexOf("calculus"));
    });
  });

  // reinforcement-cycles-pass (§29, premortem 5): a cycle here must NOT fail.
  describe("reinforcement-cycles-pass", () => {
    it("a reinforcement cycle is legal and traversal terminates", () => {
      const edges = [rein("Functions", "Derivatives"), rein("Derivatives", "Optimisation"), rein("Optimisation", "Functions")];
      const closure = reinforcement.reinforcementClosure(edges, ["Functions"], 10, 100);
      expect(closure.truncated).toBe(false); // terminates despite the cycle
      expect(closure.nodes.map((n) => n.id).sort()).toEqual(["Derivatives", "Functions", "Optimisation"]);
    });
  });

  // graph-conflict (§29, §11.5): a pair may not be in BOTH dependency and reinforcement, same direction.
  describe("graph-conflict", () => {
    it("flags a pair present in both graphs same direction; allows the reverse", () => {
      const deps = [dep("Derivatives", "Limits")];
      const reins = [rein("Derivatives", "Limits"), rein("Limits", "Derivatives")]; // 1st conflicts, 2nd legal
      expect(graphConflicts(deps, reins)).toEqual([{ fromId: "Derivatives", toId: "Limits" }]);
      expect(wouldConflict(deps, "Derivatives", "Limits")).toBe(true);
      expect(wouldConflict(deps, "Limits", "Derivatives")).toBe(false); // reverse is fine
    });
  });

  // traversal-bounded (§29, §18B.1): maxDepth/maxNodes are respected; truncation is reported.
  describe("traversal-bounded", () => {
    const chain: Edge[] = [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "D" }, { from: "D", to: "E" }];
    it("maxDepth stops expansion", () => {
      const r = boundedTraverse(["A"], adjacencyFrom(chain, "forward"), 2, 100);
      expect(r.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
      expect(r.truncated).toBe(false);
    });
    it("maxNodes truncates and REPORTS it (never a silent cap)", () => {
      const r = boundedTraverse(["A"], adjacencyFrom(chain, "forward"), 100, 3);
      expect(r.nodes.length).toBe(3);
      expect(r.truncated).toBe(true);
    });
  });

  // quote-never-served (§29, §27.1): the verbatim Provenance.quote is verification evidence and
  // is NEVER served to a learner — it lives only on Provenance, never on a served Statement.
  describe("quote-never-served", () => {
    it("a served statement carries no quote; the quote stays on Provenance", async () => {
      const store = createMemoryStore();
      const ctx = await store.putContext({ jurisdiction: "IN" });
      const QUOTE = "VERBATIM_COPYRIGHTED_SOURCE_TEXT_XYZZY";
      const s = { ...buildStatement({ kind: "FACT", form: "SPO", structure: { subjectId: "S", predicate: "p", objectId: "O" }, text: "written in our own words", contextId: ctx.id }), subjectId: "S", trustLevel: "COMMUNITY_REVIEWED" as const };
      await store.putStatement(s);
      await store.putProvenance({ statementId: s.id, sourceId: "src", chunkId: "ch", locator: {}, quote: QUOTE, extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date() });

      const served = await store.statementsForSubject("S", "PUBLIC", POLICIES.GENERAL_SCHOOL);
      expect(served).toHaveLength(1);
      // no field of a served statement contains the quote, and there is no `quote` key at all
      expect(JSON.stringify(served[0])).not.toContain(QUOTE);
      expect(served[0]).not.toHaveProperty("quote");
      // the quote is reachable ONLY via the provenance path (review/verification), never learner content
      expect((await store.provenanceFor(s.id))[0].quote).toBe(QUOTE);
    });
  });

  // no-delete (§29, S5): no destructive path exists anywhere under knowledge/.
  describe("no-delete", () => {
    it("no knowledge module contains a delete/drop/truncate path (derived caches excepted)", () => {
      const root = join(process.cwd(), "src", "server", "knowledge");
      const offenders: string[] = [];
      const destructive = /\.delete(Many)?\s*\(|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i;
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
            // Line-by-line so a DERIVED cache clear (ADR-11, §18) can be exempted explicitly with
            // a `no-delete-ok:` marker — knowledge itself still has no destructive path (ADR-5).
            readFileSync(p, "utf8").split("\n").forEach((line) => {
              if (destructive.test(line) && !line.includes("no-delete-ok")) offenders.push(p.slice(p.indexOf("/src/") + 1));
            });
          }
        }
      };
      walk(root);
      expect(offenders, `destructive paths found: ${offenders.join(", ")}`).toEqual([]);
    });
  });
});
