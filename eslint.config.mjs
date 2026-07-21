import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Production guardrail: no stray console noise in the app bundle. `warn`/`error`
  // stay allowed for the block error boundary's diagnostic logging.
  {
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vitest + standalone dev backend stub + dev scripts are not part of the app bundle.
    "dev-backend/**",
    "scripts/**",
    "vitest.config.ts",
  ]),
]);

export default eslintConfig;
