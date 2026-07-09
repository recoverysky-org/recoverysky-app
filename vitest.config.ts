import { defineConfig } from "vitest/config"

// Vitest owns pure .ts unit tests; jest-expo (jest.config.js) owns .tsx component
// tests. Vitest has no RN/Babel transform, so if it picks up a .tsx file the
// import chain hits RN's Flow-typed source and dies with "Unexpected token 'typeof'".
//
// `.claude/worktrees/**` holds full nested checkouts of this repo (see
// superpowers:using-git-worktrees). Without excluding it, both Vitest and Jest
// glob-discover every test file twice — once in the real tree, once in the worktree
// copy — doubling the failure count and making a single real failure look like two.
// *.e2e.test.ts files hit live infra (e.g. logger.e2e.test.ts needs a reachable
// Loki) and must NOT run as part of the regular unit suite — they'd fail on any
// machine without network access to that infra. They run separately via
// `npm run test:e2e` (vitest.e2e.config.ts).
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.claude/**",
      "**/dist/**",
      "**/.git/**",
      "**/*.e2e.test.ts",
    ],
  },
})
