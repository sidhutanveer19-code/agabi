// Populate a knowledge graph from a dataset using the FREE LOCAL Ollama model (real extraction).
// Run: npx tsx scripts/populate.ts [dataset-dir] [model]
import { loadDataset } from "@/server/content/dataset";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { ollamaInvoker } from "@/server/advisors/knowledge/invoke";
import { coverageReport } from "@/server/knowledge/coverage";
import { POLICIES } from "@/server/knowledge/trust/policy";

const dir = process.argv[2] ?? "datasets/sample-science";
const model = process.argv[3] ?? "qwen2.5:7b";
const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

async function main() {
  const store = createMemoryStore();
  const invoke = ollamaInvoker(base, model, new AbortController().signal);

  console.log(`Populating "${dir}" with ${model} @ ${base} …`);
  const r = await loadDataset(dir, store, invoke, { modelId: model });
  console.log("\n=== RESULT ===");
  console.log("dataset:", r.id, "| profile:", r.profile, "| sources:", r.sources, "| counts:", r.counts);

  const concepts = await store.listConcepts("PUBLIC");
  console.log("\nCONCEPTS extracted (" + concepts.length + "):", concepts.map((c) => c.name).sort());

  console.log("\nSTATEMENTS (real, MACHINE_PROPOSED):");
  for (const c of concepts) {
    for (const s of await store.statementsForSubject(c.id, "PUBLIC", POLICIES.RND)) console.log(`  • ${c.name} — "${s.text}"`);
  }

  const cov = await coverageReport(store, "PUBLIC", POLICIES.RND);
  console.log("\nCOVERAGE:", { concepts: cov.concepts, covered: cov.coveredConcepts, coverageRate: cov.coverageRate.toFixed(2), groundingRate: cov.groundingRate.toFixed(2) });
  console.log("hierarchy:", JSON.stringify(r.results[0].hierarchy.nodes.map((n) => ({ [n.level]: n.title, sections: n.children.map((x) => x.title) }))));
}
main().catch((e) => { console.error(e); process.exit(1); });
