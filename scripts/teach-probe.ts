// Live proof for Phase 2 source-grounding: for each in-syllabus topic, builds the REAL grounded
// outline from the ingested NCERT corpus (Postgres full-text) and prints the grounding evidence —
// so "does it teach from the book, non-generic?" is answered with data, not vibes.
//
//   npm run teach:probe            (defaults to the 3 plan topics)
//   npm run teach:probe -- "trigonometry"
//
// Grounded (non-generic) ⇒ a non-null outline, promptVersion "source-grounded@1", a real NCERT
// passage + citation baked into each slot intent. A miss ⇒ null (caller would fall back to web/default).
import { sourceGroundedOutline, defaultKnowledgeStore, SOURCE_PROMPT_VERSION } from "@/server/conversation/grounding";

const DEFAULT_TOPICS = ["real numbers", "quadratic equations", "Euclid's division lemma"];

async function probe(topic: string): Promise<boolean> {
  const store = defaultKnowledgeStore();
  const g = await sourceGroundedOutline(store, topic);

  console.log(`\n─── "${topic}" ───`);
  if (!g) {
    console.log(`  ❌ NO grounding — corpus has no passage for this topic → would fall back (generic/web).`);
    return false;
  }

  const cited = g.outline.some((s) => /NCERT|Ch|chapter|—/i.test(s.intent));
  const grounded = g.promptVersion === SOURCE_PROMPT_VERSION;
  console.log(`  ✅ GROUNDED  · ${g.outline.length} blocks · promptVersion=${g.promptVersion}` +
    (grounded ? "" : "  ⚠ NOT source-grounded promptVersion"));
  console.log(`  block types: ${g.outline.map((s) => s.type).join(", ")}`);
  console.log(`  citation present in intents: ${cited ? "yes" : "NO ⚠"}`);
  console.log(`  first slot intent (the non-generic contract the model must obey):`);
  console.log(`    "${g.outline[0].intent.slice(0, 260)}…"`);
  return grounded && cited;
}

async function main() {
  const arg = process.argv[2];
  const topics = arg ? [arg] : DEFAULT_TOPICS;
  console.log(`=== TEACH PROBE — Phase 2 source grounding (live corpus) ===`);

  let ok = 0;
  for (const t of topics) if (await probe(t)) ok++;

  console.log(`\n=== ${ok}/${topics.length} topics produced a real GROUNDED, cited outline ===`);
  if (ok === 0) {
    console.error(`❌ nothing grounded — check DATABASE_URL + corpus ingested (npm run ingest:corpus) + SOURCE_GROUNDING.`);
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
