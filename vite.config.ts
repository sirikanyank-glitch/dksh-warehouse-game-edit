import { defineConfig } from 'vitest/config'

// base './' keeps the build portable: dist/ can be put in any folder or on any web host.
export default defineConfig({
  base: './',
  server: { host: true, port: 3000 },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 4600, sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
