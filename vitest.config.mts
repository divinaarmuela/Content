import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // An agent's isolated worktree lives under .claude/worktrees and carries a
    // full copy of this suite; collecting it doubles every run and reports a
    // mid-edit copy's failures as ours.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/worktrees/**'],
    /**
     * The two kill-switches, on for the whole suite.
     *
     * `app/lib/mailer.ts` refuses to send to anything but a `.invalid`
     * address when EMAIL_TEST_ONLY is set, so a route test that walks an
     * approval path and forgets to mock the mailer fails loudly instead of
     * emailing a real person. The E2E config sets the same flag
     * (tests/e2e/load-env.ts) — the floor should not be a per-file habit.
     *
     * PUBLISH_DRY_RUN is here for exactly the reason that comment gave for
     * EMAIL_TEST_ONLY, and it was missing. Today nothing in the suite can
     * reach a real channel — every test that queues a job mocks the
     * publisher, and `getPublisher()` falls back to the unconfigured one with
     * no ZERNIO_API_KEY — but "the key is not in your shell" is not a floor,
     * it is a coincidence. A developer with the key exported has no other
     * protection, and publishing is the one action this system cannot undo.
     */
    env: { EMAIL_TEST_ONLY: '1', PUBLISH_DRY_RUN: '1' },
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
