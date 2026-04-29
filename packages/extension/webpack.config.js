//@ts-check

"use strict";

const path = require("path");

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: "node",
  mode: "none",
  entry: "./src/extension.ts",
  externals: ["vscode"],
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: "ts-loader" }],
      },
    ],
  },
  // Watch for changes in the webview dist folder to trigger rebuilds
  watchOptions: {
    ignored: /node_modules/,
    poll: 1000, // Check for changes every second
  },
  // Add webview files as dependencies so webpack rebuilds when they change
  plugins: [
    {
      apply: (compiler) => {
        compiler.hooks.thisCompilation.tap("WatchWebviewPlugin", (compilation) => {
          const webviewDistPath = path.resolve(__dirname, "../pnp-webview/dist");
          compilation.fileDependencies.add(webviewDistPath);
        });
      },
    },
  ],
};

module.exports = extensionConfig;

