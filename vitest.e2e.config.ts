import { defineConfig } from "vitest/config"

// Counterpart to vitest.config.ts, scoped to *.e2e.test.ts only. These tests hit
// live infra (e.g. logger.e2e.test.ts needs a reachable Loki) and are run
// separately via `npm run test:e2e` so the regular unit suite (`npm test` /
// `npm run test:unit`) stays fast and doesn't fail on machines without network
// access to that infra.
export default defineConfig({
  test: {
    include: ["**/*.e2e.test.ts"],
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**", "**/.git/**"],
  },
})
