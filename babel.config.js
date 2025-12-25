const path = require("path")

/** @type {import('@babel/core').TransformOptions} */
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: ["."],
          alias: {
            "@": "./app",
            "@assets": "./assets",
            "@common": path.resolve(__dirname, "../recoverysky-common/lib/browser"),
            "@common/sqlite": path.resolve(__dirname, "../recoverysky-common/lib/sqlite"),
          },
        },
      ],
      // Enable importing .sql files as strings for Drizzle migrations
      ["inline-import", { extensions: [".sql"] }],
    ],
  }
}
