/**
 * Jest configuration for React Native component tests.
 *
 * This config runs tests using jest-expo for React Native components.
 * For pure TypeScript unit tests, use Vitest (npm run test:unit).
 *
 * @type {import('@jest/types').Config.ProjectConfig}
 */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/test/setup.ts"],
  // Only include .tsx component tests - .ts unit tests use Vitest
  testMatch: ["**/*.test.tsx"],
  // jest-expo's preset auto-derives moduleNameMapper from tsconfig.json's
  // `paths` (see node_modules/jest-expo/src/preset/withTypescriptMapping.js).
  // tsconfig.json maps "@recoverysky-org/common/browser"/"/sqlite" to
  // themselves (an identity entry that only exists to steer tsc's `bundler`
  // resolution at those subpaths) — the auto-derivation naively rewrites that
  // into "<rootDir>/@recoverysky-org/common/browser", a path that doesn't
  // exist, so ANY component under test that imports from the common package
  // fails with "Could not locate module". First hit: InPersonScheduleRow.tsx
  // (2026-08-03), the first jest-expo test to import `@recoverysky-org/common`.
  // These two entries override the broken auto-derived ones (Jest merges
  // config-level moduleNameMapper over the preset's per-key) and point
  // straight at the built files.
  moduleNameMapper: {
    "^@recoverysky-org/common/browser$":
      "<rootDir>/node_modules/@recoverysky-org/common/lib/browser.js",
    "^@recoverysky-org/common/sqlite$":
      "<rootDir>/node_modules/@recoverysky-org/common/lib/sqlite.js",
  },
  // The common package ships ESM-only ("type": "module", no "require"
  // condition in its exports map — see its package.json). Babel-jest must
  // transform it like first-party source instead of being skipped as
  // "already CJS" node_modules; the preset's default ignore pattern doesn't
  // list this scope, so it's added here alongside the same allowlist
  // react-native/jest-preset already carries.
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|@recoverysky-org|jose|@jenova-marie|@trex-ts|lodash-es|uuid))",
    "/node_modules/react-native-reanimated/plugin/",
  ],
  // .claude/worktrees holds full nested checkouts of this repo — without ignoring
  // it, Jest discovers and runs every .tsx test twice (once per checkout).
  // CHANGED 2026-08-03: anchored to <rootDir>. The old bare "/\\.claude/" was an
  // unanchored regex tested against each file's ABSOLUTE path, so running Jest
  // from *inside* a worktree (whose own path contains /.claude/) excluded every
  // test in the repo and reported "No tests found" — a green-looking no-op.
  // Anchoring keeps the double-discovery fix intact from the main checkout while
  // letting the suite actually run inside a worktree.
  testPathIgnorePatterns: [
    "/node_modules/",
    "/MeetingSDK-ReactNative-Quickstart/",
    "<rootDir>/\\.claude/",
  ],
}
