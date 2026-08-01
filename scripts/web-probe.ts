// Live proof for Phase 3 web fallback: hits the REAL Tavily API with the configured key and confirms
// an off-corpus query returns results + builds a web-grounded lesson. Run AFTER TAVILY_API_KEY is set.
//
//   npm run web:probe            (default: "quantum computing")
//   npm run web:probe -- "who is Elon Musk"
import { tavilySearch, webGroundedOutline } from "@/server/retrieval/web";

async function main() {
  const q = process.argv[2] ?? "quantum computing";
  console.log(`\n=== WEB PROBE — live Tavily ===\nquery: "${q}"`);

  const t0 = Date.now();
  const results = await tavilySearch(q); // real HTTP call, real key
  const ms = Date.now() - t0;
  console.log(`tavily → ${results.length} results in ${ms}ms`);
  for (const r of results.slice(0, 3)) console.log(`   · ${r.title} — ${r.content.slice(0, 80)}…`);

  if (results.length === 0) {
    console.error(`\n❌ 0 results — key missing/invalid, or WEB_GROUNDING/network issue. Check .env.local.`);
    process.exit(1);
  }

  // reuse the fetched results (don't spend a second search) to build the lesson
  const g = await webGroundedOutline(q, async () => results);
  if (!g) {
    console.error(`\n❌ results came back but no lesson built — unexpected.`);
    process.exit(1);
  }
  console.log(`\n✅ web lesson built: ${g.outline.length} blocks · ${g.promptVersion} · source-labelled web`);
  console.log(`   first block: ${g.outline[0].type} "${g.outline[0].intent}"`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
