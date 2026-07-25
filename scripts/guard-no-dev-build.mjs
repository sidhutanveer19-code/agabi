// PERMANENT guard (Principle 8 — make the wrong thing impossible): refuse `npm run build` while a
// Next dev server is running. Build + dev share `.next`; building clobbers the dev server and it then
// serves broken/stale chunks (CLAUDE.md "Gotchas"). This recurred by hand — now it can't.
// Escape hatch (CI has no dev, port free → passes automatically): set ALLOW_DEV_BUILD=1.
import { execSync } from "node:child_process";

if (process.env.ALLOW_DEV_BUILD === "1") process.exit(0);

function running() {
  try {
    const port = execSync("lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null || true", { encoding: "utf8" });
    if (/LISTEN/.test(port)) return true;
    const procs = execSync("ps ax -o command 2>/dev/null | grep -E 'next dev|next-server' | grep -v grep || true", { encoding: "utf8" });
    return procs.trim().length > 0;
  } catch {
    return false;
  }
}

if (running()) {
  console.error("\n❌ guard: a Next dev server is running (port 3000 / next-server).");
  console.error("   Building now clobbers .next and breaks dev. Stop it first:");
  console.error("     pkill -f 'next dev'  &&  npm run build");
  console.error("   (or ALLOW_DEV_BUILD=1 to override).\n");
  process.exit(1);
}
