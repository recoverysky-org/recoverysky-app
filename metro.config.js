/* eslint-env node */
// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// Path to recoverysky-common (linked package)
const commonPath = path.resolve(__dirname, "../recoverysky-common")

// Path to trex-ts (linked via @trex-ts/core symlink)
const trexPath = path.resolve(__dirname, "../../trex/trex-ts")

// Watch linked packages for changes
config.watchFolders = [commonPath, trexPath]

// Resolve @common and @sqlite aliases
config.resolver.extraNodeModules = {
  "@common": path.resolve(commonPath, "lib/browser"),
  "@sqlite": path.resolve(commonPath, "lib/sqlite"),
}

// Tell Metro where to find dependencies for linked packages
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(commonPath, "node_modules"),
  path.resolve(trexPath, "node_modules"),
]

config.transformer.getTransformOptions = async () => ({
  transform: {
    // Inline requires are very useful for deferring loading of large dependencies/components.
    // For example, we use it in app.tsx to conditionally load Reactotron.
    // However, this comes with some gotchas.
    // Read more here: https://reactnative.dev/docs/optimizing-javascript-loading
    // And here: https://github.com/expo/expo/issues/27279#issuecomment-1971610698
    inlineRequires: true,
  },
})

// This is a temporary fix that helps fixing an issue with axios/apisauce.
// See the following issues in Github for more details:
// https://github.com/infinitered/apisauce/issues/331
// https://github.com/axios/axios/issues/6899
// The solution was taken from the following issue:
// https://github.com/facebook/metro/issues/1272
config.resolver.unstable_conditionNames = ["require", "default", "browser"]

// This helps support certain popular third-party libraries
// such as Firebase that use the extension cjs.
config.resolver.sourceExts.push("cjs")

// Add .sql extension for Drizzle ORM migrations
config.resolver.sourceExts.push("sql")

// Add .wasm extension for expo-sqlite web support (wa-sqlite)
config.resolver.assetExts.push("wasm")

module.exports = config
