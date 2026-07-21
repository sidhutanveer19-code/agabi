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

  it("advisors/ never import prisma, the db, conversation/, or evaluation/", () => {
    for (const f of files.filter(isAdvisor)) {
      for (const i of importsOf(f)) {
        const breach = i.includes("prisma") || i.includes("/server/db") || i.includes("/server/conversation/") || i.includes("/server/evaluation/");
        expect(breach, `advisor ${rel(f)} breaches the wall via '${i}'`).toBe(false);
      }
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
