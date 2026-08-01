import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The three walls, enforced by grep. This is what stops the architecture drifting
 * back: an advisor that CANNOT import the database cannot write to it — not
 * discouraged, impossible. NO `import type` exemption: a type import across the wall
 * is still a breach.
 */
const ROOT = join(process.cwd(), "src", "server");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs: string[] = [];
  const re = /(?:from|import)\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

const files = walk(ROOT);
const rel = (f: string) => f.slice(f.indexOf("/src/server/") + 1);
const isAdvisor = (f: string) => f.includes("/server/advisors/");
const isEval = (f: string) => f.includes("/server/evaluation/");
const isEvidence = (f: string) => f.includes("/server/evidence/");
const isHealth = (f: string) => f.includes("/server/health/");
const isAiSdk = (i: string) => i === "ai" || i.startsWith("@ai-sdk/");

describe("architecture — the three walls (no type-import exemption)", () => {
  it("only files under advisors/ may import an AI SDK", () => {
    for (const f of files) {
      if (isAdvisor(f)) continue;
      const bad = importsOf(f).filter(isAiSdk);
      expect(bad, `${rel(f)} imports AI SDK outside advisors/: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("advisors/ import ONLY ai, @ai-sdk/*, zod, @/env, node:*, and other advisors/", () => {
    const allowed = (i: string) =>
      isAiSdk(i) || i === "zod" || i === "@/env" || i.startsWith("node:") || i.startsWith("@/server/advisors/");
    for (const f of files.filter(isAdvisor)) {
      for (const i of importsOf(f)) {
        expect(allowed(i), `advisor ${rel(f)} imports forbidden '${i}'`).toBe(true);
      }
    }
  });

  it("advisors/ never import prisma, the db, conversation/, evaluation/, evidence/, or health/", () => {
    for (const f of files.filter(isAdvisor)) {
      for (const i of importsOf(f)) {
        const breach = i.includes("prisma") || i.includes("/server/db") || i.includes("/server/conversation/") || i.includes("/server/evaluation/") || i.includes("/server/evidence/") || i.includes("/server/health/");
        expect(breach, `advisor ${rel(f)} breaches the wall via '${i}'`).toBe(false);
      }
    }
  });

  it("evidence/ and health/ are infrastructure — they never import advisors/", () => {
    for (const f of files.filter((x) => isEvidence(x) || isHealth(x))) {
      const bad = importsOf(f).filter((i) => i.startsWith("@/server/advisors/") || i.includes("/server/advisors/"));
      expect(bad, `${rel(f)} imports advisors/: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("nothing outside evaluation/ imports evaluation/", () => {
    for (const f of files) {
      if (isEval(f)) continue;
      const bad = importsOf(f).filter((i) => i.includes("/server/evaluation/"));
      expect(bad, `${rel(f)} imports evaluation/: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("evaluation/ imports no AI SDK (it would belong under advisors/)", () => {
    for (const f of files.filter(isEval)) {
      expect(importsOf(f).filter(isAiSdk), `${rel(f)} imports AI SDK`).toEqual([]);
    }
  });
});

/**
 * The knowledge-platform walls (architecture §9.1, W2–W7). Same grep enforcement, same
 * no-type-import-exemption rule. W6/W7 are the structural defence against the three graphs
 * silently re-merging (premortem cause 5): a refactor that unifies them must delete a test.
 */
const isKnowledge = (f: string) => f.includes("/server/knowledge/");
const isKnowledgeStore = (f: string) => f.includes("/server/knowledge/store/");
const isIngest = (f: string) => f.includes("/server/ingest/");
const isObservation = (f: string) => f.includes("/server/observation/");
const importsPrisma = (i: string) => i.includes("@prisma/client") || i.includes("/server/db");
const importsKnowledgeStore = (i: string) => i.includes("/server/knowledge/store");

describe("architecture — the knowledge platform walls (W2–W7)", () => {
  it("W2 — knowledge/ never imports advisors/", () => {
    for (const f of files.filter(isKnowledge)) {
      const bad = importsOf(f).filter((i) => i.includes("/server/advisors/"));
      expect(bad, `${rel(f)} imports advisors/: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("W3 — ingest/ never imports the knowledge store", () => {
    for (const f of files.filter(isIngest)) {
      const bad = importsOf(f).filter(importsKnowledgeStore);
      expect(bad, `${rel(f)} imports the store directly: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("W4 — observation/ never imports the knowledge store", () => {
    for (const f of files.filter(isObservation)) {
      const bad = importsOf(f).filter(importsKnowledgeStore);
      expect(bad, `${rel(f)} couples to the knowledge store: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("W5 — inside knowledge/, only store/ imports Prisma (engine lock stays in one place)", () => {
    for (const f of files.filter((x) => isKnowledge(x) && !isKnowledgeStore(x))) {
      const bad = importsOf(f).filter(importsPrisma);
      expect(bad, `${rel(f)} imports Prisma outside knowledge/store/: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("W6 — graph/dependency.ts never imports graph/reinforcement.ts", () => {
    for (const f of files.filter((x) => x.endsWith("/graph/dependency.ts"))) {
      const bad = importsOf(f).filter((i) => i.includes("/graph/reinforcement"));
      expect(bad, `${rel(f)} imports the reinforcement graph: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("W7 — graph/composition.ts never imports dependency.ts or reinforcement.ts", () => {
    for (const f of files.filter((x) => x.endsWith("/graph/composition.ts"))) {
      const bad = importsOf(f).filter((i) => i.includes("/graph/dependency") || i.includes("/graph/reinforcement"));
      expect(bad, `${rel(f)} imports another graph: ${bad.join(", ")}`).toEqual([]);
    }
  });
});
