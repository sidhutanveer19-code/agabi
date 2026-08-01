import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for the Agabi core unit suite. Pure-logic tests (no DOM/React
 * render) over the critical seams: URL safety, the safe math evaluator, versioned
 * serialization round-trip, the block registry, and the shared API contract.
 * Path aliases mirror tsconfig (`@/*` → src, `@contract` → contract).
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@contract\/(.*)$/, replacement: path.resolve(__dirname, "contract/$1") },
      { find: "@contract", replacement: path.resolve(__dirname, "contract/index.ts") },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "src/$1") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "contract/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // vitest 4: `include` (not the removed `all`) is what enumerates EVERY source file into coverage
      // — untested logic files now count as 0% (honest denominator). `.ts`-only, so `.tsx` UI is left
      // out (owned by Playwright/e2e); also excluded explicitly below.
      include: ["src/**/*.ts", "contract/**/*.ts"],
      reporter: ["text-summary", "lcov"], // lcov → coverage/lcov.info (uploaded in CI + read by Sonar)
      reportsDirectory: "coverage",
      // `**/*.tsx` = UI components, owned by Playwright/e2e (node can't render them) — out of the UNIT
      // coverage denominator so 90 is measured over logic only, reachable and not weakened.
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/types.ts", "node_modules/**", ".next/**", "e2e/**", "scripts/**", "coverage/**", "**/*.tsx"],
      // Ratchet floors — set just BELOW current LOCAL coverage (stmts 89.5 / br 78.6 / fn 83.8 /
      // lines 91.1) so the build stays green today but a real drop FAILS CI. CI also runs the Postgres
      // conformance (RUN_DB_CONFORMANCE=1), so CI coverage is >= local — these floors are safe there.
      // Raise as coverage climbs (target: branches 90); never lower (§H1 — never weaken a gate).
      // This is the merge-blocking coverage rule (Law 5 prove-on-real-case).
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
