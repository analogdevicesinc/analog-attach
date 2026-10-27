import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // The tests import the package by name; run them on the sources, not on a build that may be stale
    resolve: {
        alias: [{ find: /^attach-lib$/, replacement: fileURLToPath(new URL('src/index.ts', import.meta.url)) }],
    },
    test: {
        environment: 'node',
        globals: true,
        globalSetup: ['./vitest.globalSetup.ts'],
        includeSource: ['src/**/*.ts'],
        exclude: ['out/**/*'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'lcov'],
            include: ['src/**/*.ts',],
            exclude: ['src/**/*.test.ts', 'test/**/*.ts'],
        },
    },
    server: {
        watch: {
            ignored: ['**/linux/**', '**/dt-schema/**', '**/node_modules/**'],
        },
    },
});
