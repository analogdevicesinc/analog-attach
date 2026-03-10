import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'packages/extension/out/**/*.test.js',
	mocha: {
		inlineDiffs: true
	}
});
