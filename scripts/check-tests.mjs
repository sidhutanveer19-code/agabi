// PERMANENT fix for Root 2 (untested code passes every green gate). A newly-added `src/**/*.ts` LOGIC
// file must ship with a `.test.ts`, OR carry an explicit `// @no-test-ok: <reason>` line — a CONSCIOUS
// choice, never a silent skip. `.tsx` (DOM/visual components) are exempt. Runs on the staged diff.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const staged = execSync("git diff --cached --name-only --diff-filter=AM", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const offenders = [];
for (const f of staged) {
  if (!f.startsWith("src/")) continue;
  if (!f.endsWith(".ts")) continue; // .tsx components exempt (need a DOM harness)
  if (f.endsWith(".test.ts") || f.endsWith(".d.ts") || f.endsWith("/types.ts")) continue;
  const testFile = f.replace(/\.ts$/, ".test.ts");
  if (existsSync(testFile)) continue;
  let body = "";
  try { body = readFileSync(f, "utf8"); } catch { continue; }
  if (/@no-test-ok:/.test(body)) continue; // explicit, justified exemption
  offenders.push(f);
}

if (offenders.length) {
  console.error("\n❌ test-presence: these new logic files have NO test (write one, or add a line");
  console.error("   `// @no-test-ok: <why>` to consciously exempt — never silently):");
  for (const o of offenders) console.error("   · " + o);
  console.error("");
  process.exit(1);
}
