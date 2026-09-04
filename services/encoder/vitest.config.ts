import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // nothing in this package may reach the network: the only tests are of
    // the pure argument builder, which touches neither ffmpeg nor R2
    environment: 'node',
  },
})
