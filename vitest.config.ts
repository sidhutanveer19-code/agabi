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
  },
});
