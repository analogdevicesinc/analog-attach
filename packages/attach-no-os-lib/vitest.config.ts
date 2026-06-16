import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        setupFiles: ['./test/setup.ts'],
        includeSource: ['src/**/*.ts'],
        exclude: ['out/**/*'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'lcov'],
            include: ['src/**/*.ts',],
            exclude: ['src/**/*.test.ts', 'test/**/*.ts'],
        },
    },
});
