import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // `server-only` throws on import outside a server context; tests run in
    // node, so alias it to a no-op stub to allow testing server modules.
    alias: [{ find: /^server-only$/, replacement: "./tests/stubs/server-only.ts" }],
  },
})
