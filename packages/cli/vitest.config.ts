import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		includeSource: ["src/**/*.ts"],
		// The CLI's tests, and the GUI's (plain ES modules, no runner of their own: the CLI serves them),
		// beside their code or in its test/.
		include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "../gui/src/**/*.test.mjs", "../gui/test/**/*.test.mjs"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "lcov"],
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/testing/**"],
		},
	},
});
