import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
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
