import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    /**
     * The kill-switch, on for the whole suite.
     *
     * `app/lib/mailer.ts` refuses to send to anything but a `.invalid`
     * address when this is set, so a route test that walks an approval path
     * and forgets to mock the mailer fails loudly instead of emailing a real
     * person. The E2E config sets the same flag (tests/e2e/load-env.ts) — the
     * floor should not be a per-file habit. Same reasoning as
     * PUBLISH_DRY_RUN: the thing that must never happen is prevented from
     * the inside, not remembered.
     */
    env: { EMAIL_TEST_ONLY: '1' },
    alias: [
      // `server-only` throws on import outside a server context; tests run in
      // node, so alias it to a no-op stub to allow testing server modules.
      { find: /^server-only$/, replacement: "./tests/stubs/server-only.ts" },
      // the same `@/*` → repo root that tsconfig gives the app, so a route or
      // a server module can be imported here exactly as it is in production
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
    ],
  },
})
