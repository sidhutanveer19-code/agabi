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
      reporter: ["text-summary", "lcov"], // lcov → coverage/lcov.info (uploaded in CI + read by Sonar)
      reportsDirectory: "coverage",
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/types.ts", "node_modules/**", ".next/**", "e2e/**", "scripts/**", "coverage/**"],
      // Ratchet floors — set just BELOW current (stmts 79 / br 66 / fn 74 / lines 81) so the build stays
      // green today but a real drop FAILS CI. Raise these as coverage climbs; never lower them (§H1 —
      // never weaken a gate). This is the merge-blocking coverage rule (Law 5 prove-on-real-case).
      thresholds: { statements: 83, branches: 70, functions: 78, lines: 85 },
    },
  },
});
