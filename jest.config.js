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
