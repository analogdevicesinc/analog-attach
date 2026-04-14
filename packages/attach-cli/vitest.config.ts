import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        includeSource: ['src/**/*.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts'],
        },
    },
});
