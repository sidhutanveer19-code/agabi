import { describe } from "vitest";
import { prisma } from "@/server/db";
import { describeConformance } from "@/server/knowledge/store/conformance";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { createPostgresStore } from "@/server/knowledge/store/postgres";

// The in-memory store is the reference implementation (§5.1) — it runs the full contract
// unconditionally and is what proves M0.
describeConformance("memory", createMemoryStore);

// Every knowledge table, so the Postgres conformance run starts from a truly empty platform.
// Test-only: knowledge itself has no delete path (L5); this lives in a `.test.ts` (exempt from
// the no-delete scan) purely as integration-test hygiene against a persistent DB.
const KNOWLEDGE_TABLES = [
  "Provenance", "SourceChunk", "Source", "ConceptAlias", "ConceptTag",
  "DependencyEdge", "CompositionEdge", "ReinforcementEdge", "Contradiction", "Statement",
  "AssetEfficacy", "TeachingAsset", "ItemConcept", "AssessmentItem", "ObjectiveConcept",
  "LearningObjective", "Mapping", "ProgramNode", "Program", "ReleaseMember", "Release",
  "ClosureCache", "Context", "ContextDimension", "Concept",
];
const resetPostgres = async () => {
  const list = KNOWLEDGE_TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};

// The Postgres store runs the IDENTICAL suite, but only against a real database. The M0
// knowledge-tables `db push` is a human-gated op (A-2, G7); until it is run there is no
// schema to query, so this is skipped rather than failed. Set RUN_DB_CONFORMANCE=1 after
// the push to exercise engine parity. (`createPostgresStore` is still imported + built
// here so it stays type-checked every run — a compile break surfaces immediately.)
const runDb = process.env.RUN_DB_CONFORMANCE === "1";
if (runDb) {
  describeConformance("postgres", createPostgresStore, resetPostgres);
} else {
  describe.skip("KnowledgeStore conformance — postgres (gated: needs the M0 db push)", () => {});
  void createPostgresStore; // keep the import live so postgres.ts type-checks every run
}
