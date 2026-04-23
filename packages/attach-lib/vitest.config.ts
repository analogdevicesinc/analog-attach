import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
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
