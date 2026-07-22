#!/usr/bin/env node
// Review CLI (§25.2) — the reviewer ergonomics that turn ~60/hr into ~200/hr: the source
// passage is read ONCE for a screen of ≤8 proposals, the grounded quote is highlighted in
// place (verification by COMPARISON, not recall), and approve-all is one keystroke.
//
// Operator tooling — self-contained, dependency-free. Reads a proposals JSON, writes a
// decisions JSON. The trust write itself goes through the typed submitStatementReview path
// (knowledge/review.ts); this is the human-facing front end that produces the decisions.
//
//   node scripts/review-cli.mjs proposals.json [decisions.json]
//
// proposals.json: [{ targetId, chunkText, quote, text, validation: [{validator,outcome,reason}] }]

import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const SCREEN = 8;
const ESC = { dim: "\x1b[2m", hi: "\x1b[43m\x1b[30m", bold: "\x1b[1m", reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m" };

// V3 §14.1 normalisation, mirrored so the CLI needs no build step.
const n = (s) =>
  s.normalize("NFC").replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

function highlight(chunkText, quote) {
  const nc = n(chunkText), nq = n(quote);
  const i = nc.indexOf(nq);
  if (i < 0) return `${ESC.red}[quote not grounded]${ESC.reset} ${nc}`;
  return nc.slice(0, i) + ESC.hi + nc.slice(i, i + nq.length) + ESC.reset + nc.slice(i + nq.length);
}

const ask = (rl, q) => new Promise((res) => rl.question(q, res));

async function main() {
  const [, , inPath, outPath = "decisions.json"] = process.argv;
  if (!inPath) {
    console.error("usage: node scripts/review-cli.mjs proposals.json [decisions.json]");
    process.exit(2);
  }
  const proposals = JSON.parse(readFileSync(inPath, "utf8"));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const decisions = [];

  for (let s = 0; s < proposals.length; s += SCREEN) {
    const screen = proposals.slice(s, s + SCREEN);
    console.log(`\n${ESC.bold}── Review screen ${s / SCREEN + 1} (${screen.length} proposals) ──${ESC.reset}`);
    screen.forEach((p, i) => {
      console.log(`\n${ESC.bold}[${i + 1}] ${p.targetId}${ESC.reset}`);
      console.log(`  ${ESC.dim}source:${ESC.reset} ${highlight(p.chunkText ?? "", p.quote ?? "")}`);
      console.log(`  ${ESC.dim}text:  ${ESC.reset} ${p.text ?? ""}`);
      const flags = (p.validation ?? []).filter((v) => v.outcome !== "pass");
      if (flags.length) console.log(`  ${ESC.red}flags:${ESC.reset} ${flags.map((v) => `${v.validator}:${v.outcome}`).join(", ")}`);
    });

    const actor = (await ask(rl, `\nreviewer id: `)).trim();
    const rejects = (await ask(rl, `reject which? (numbers, blank = approve all): `)).trim();
    const rejectSet = new Set(rejects.split(/[,\s]+/).filter(Boolean).map(Number));
    screen.forEach((p, i) => {
      const rejected = rejectSet.has(i + 1);
      decisions.push({ targetKind: "Statement", targetId: p.targetId, decision: rejected ? "REJECT" : "APPROVE", actorId: actor });
    });
    console.log(`${ESC.green}✓ screen recorded (${screen.length - rejectSet.size} approved, ${rejectSet.size} rejected)${ESC.reset}`);
  }

  rl.close();
  writeFileSync(outPath, JSON.stringify(decisions, null, 2));
  console.log(`\nWrote ${decisions.length} decisions → ${outPath}`);
}

main();
