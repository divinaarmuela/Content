import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/**
 * Live end-to-end config — NOT part of `npm test`.
 *
 * These tests hit the real Supabase database through the real workflow layer,
 * playing each dashboard role against the dedicated "ZZ TEST" client. Run
 * explicitly with:
 *
 *   npx vitest run --config vitest.e2e.config.mts
 *
 * They stay out of the default run on purpose: `npm test` must be pure and
 * deterministic, and these are neither.
 */
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.ts"],
    setupFiles: ["tests/e2e/load-env.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    alias: [
      { find: /^server-only$/, replacement: "./tests/stubs/server-only.ts" },
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
    ],
  },
})
