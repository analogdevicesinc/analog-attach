/// <reference types="vitest/config" />

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
    plugins: [
        dts({
            insertTypesEntry: true,
            rollupTypes: true,
        }),
    ],
    build: {
        outDir: 'dist',
        lib: {
            entry: {
                index: "src/index.ts",
                browser: "src/browser.ts",
            },
            name: "attach-lib",
            formats: ["es", "cjs"],
            fileName: (format, entryName) => format === 'es' ? `${entryName}.js` : `${entryName}.cjs`,
        },
        sourcemap: true,
        emptyOutDir: true,
        ssr: true,
    },
    test: {
        includeSource: ['src/**/*.{js,ts}'],
        environment: "node"
    },
    define: {
        'import.meta.vitest': 'undefined',
    },
});