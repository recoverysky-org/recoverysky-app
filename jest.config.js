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
  testPathIgnorePatterns: ["/node_modules/", "/MeetingSDK-ReactNative-Quickstart/"],
}
