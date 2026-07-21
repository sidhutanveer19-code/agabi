// Committed 10-topic sweep [H]. Runs against a RUNNING dev server (localhost:3000).
// Provider is chosen by the server's env (set OLLAMA_ONLY=1 for the local sweep;
// leave it unset for the Groq sweep) — this script just measures and labels.
//
//   node --env-file=.env.local scripts/sweep.mjs [--label groq|ollama]
//
// Prints: per-topic table · provider×rung cross-tab · J (structural/content ratio)
// · F (eval_count distribution + p90 per block type, from slot.filled events).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = "http://localhost:3000";
const labelIdx = process.argv.indexOf("--label");
const LABEL = labelIdx > -1 ? process.argv[labelIdx + 1] : "sweep";

const TEXT = new Set(["paragraph", "richtext", "heading", "subheading", "quote", "notes", "caption", "callout", "tip", "warning", "summary", "definition", "example", "bullet", "numbered", "checklist"]);
const STRUCT = new Set(["{", "}", "[", "]", '"', ":", ","]);
const TOPICS = [
  "the pythagorean theorem", "quadratic equations", "newtons second law of motion",
  "how projectile motion works", "the periodic table", "acids and bases",
  "how photosynthesis works", "the human heart", "causes of world war one", "the water cycle",
];

async function session() {
  const r = await fetch(`${BASE}/api/session`);
  return r.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function runTopic(topic, cookie) {
  const t0 = Date.now();
  const body = JSON.stringify({ request: { kind: "lesson", topic }, context: { topic, explanations: [], selectedRegionId: null } });
  const res = await fetch(`${BASE}/api/teach`, { method: "POST", headers: { "content-type": "application/json", cookie }, body });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", ttfb = null, ttfp = null, usage = null;
  const blockTypes = [], visualPayloads = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.t === "block") { if (ttfb === null) ttfb = Date.now() - t0; blockTypes.push(e.block.type); }
      else if (e.t === "patch") { if (ttfp === null) ttfp = Date.now() - t0; const ft = blockTypes[e.index]; if (ft && !TEXT.has(ft)) visualPayloads.push(e.data); }
      else if (e.t === "usage") usage = e;
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  return { topic, ttfb, ttfp, usage, blockTypes, visualPayloads, secs };
}

function jRatio(payloads) {
  let struct = 0, total = 0;
  for (const p of payloads) {
    const s = JSON.stringify(p ?? {});
    total += s.length;
    for (const ch of s) if (STRUCT.has(ch)) struct++;
  }
  return total ? (struct / total) : 0;
}

const cookie = await session();
const runStart = new Date(); // F reads only slot.filled events from this run — no DB reset

const rows = [];
const crosstab = {}; // provider -> {1..5}
let jPayloads = [];
console.log(`\n=== SWEEP: ${LABEL} ===`);
console.log(["topic".padEnd(28), "ttfb", " ttfp", "aRate", "r1", "r2", "r3", "r4", "r5", "unr", "vis", "pV", "tok", "tok/s", "secs"].join("  "));
for (const topic of TOPICS) {
  const r = await runTopic(topic, cookie);
  const u = r.usage ?? {};
  const rc = u.rungCount ?? {};
  const vis = r.blockTypes.filter((t) => !TEXT.has(t)).length;
  const final = u.finalTypes ?? [];
  const pV = final.reduce((n, ft, i) => n + (!TEXT.has(ft) && r.blockTypes[i] === "paragraph" ? 1 : 0), 0);
  jPayloads = jPayloads.concat(r.visualPayloads);
  for (const [prov, counts] of Object.entries(u.provRung ?? {})) {
    crosstab[prov] ??= { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const k of [1, 2, 3, 4, 5]) crosstab[prov][k] += counts[k] ?? 0;
  }
  rows.push({ topic, ...u, ttfb: r.ttfb, ttfp: r.ttfp, vis, pV, secs: r.secs, blocks: r.blockTypes.length });
  console.log([
    topic.slice(0, 28).padEnd(28),
    ((r.ttfb ?? 0) / 1000).toFixed(2),
    r.ttfp != null ? (r.ttfp / 1000).toFixed(1).padStart(5) : "    -",
    (u.authorRate ?? 0).toFixed(2),
    String(rc[1] ?? 0).padStart(2), String(rc[2] ?? 0).padStart(2), String(rc[3] ?? 0).padStart(2),
    String(rc[4] ?? 0).padStart(2), String(rc[5] ?? 0).padStart(2),
    String(u.unresolved ?? 0).padStart(3), String(vis).padStart(3), String(pV).padStart(2),
    String(u.outputTokens ?? 0).padStart(5), String(u.tokPerSec ?? 0).padStart(5), String(r.secs).padStart(5),
  ].join("  "));
}

console.log("\n--- provider × rung cross-tab ---");
console.log(["provider".padEnd(22), "r1", "r2", "r3", "r4", "r5"].join("   "));
for (const [prov, c] of Object.entries(crosstab)) {
  console.log([prov.padEnd(22), ...[1, 2, 3, 4, 5].map((k) => String(c[k]).padStart(2))].join("   "));
}

console.log("\n--- J: structural vs content ---");
const j = jRatio(jPayloads);
console.log(`structural chars = ${(j * 100).toFixed(1)}% of visual JSON (${jPayloads.length} blocks). ` +
  (j < 0.10 ? "REJECT terser keys (<10%)." : j > 0.15 ? "TRIAL short keys on one type (>15%)." : "borderline (10-15%)."));

console.log("\n--- F: eval_count per block type (from slot.filled) ---");
const filled = await prisma.event.findMany({ where: { type: "slot.filled", createdAt: { gte: runStart } }, select: { payload: true } });
const byType = {};
for (const e of filled) { const p = e.payload; if (p?.tokens > 0) (byType[p.slotType] ??= []).push(p.tokens); }
const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
console.log(["type".padEnd(14), "n", "p50", "p90", "max"].join("   "));
for (const [t, arr] of Object.entries(byType).sort()) {
  console.log([t.padEnd(14), String(arr.length).padStart(2), String(pct(arr, 0.5)).padStart(4), String(pct(arr, 0.9)).padStart(4), String(Math.max(...arr)).padStart(4)].join("   "));
}

const ok = rows.filter((r) => r.usage !== undefined);
console.log("\n=== HOLDS ===");
console.log(`ttfb<1s: ${rows.every((r) => (r.ttfb ?? 9999) < 1000)}  ·  blocks==slots: ${rows.every((r) => r.blocks === r.slots)}  ·  pV=0: ${rows.every((r) => r.pV === 0)}  ·  authorRate>=0.8: ${rows.every((r) => (r.authorRate ?? 0) >= 0.8)} (min ${Math.min(...rows.map((r) => r.authorRate ?? 0)).toFixed(2)})`);
void ok;
await prisma.$disconnect();
