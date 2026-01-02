/* eslint-env node */

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
          },
        },
      ],
      // Enable importing .sql files as strings
      ["inline-import", { extensions: [".sql"] }],
    ],
  }
}
