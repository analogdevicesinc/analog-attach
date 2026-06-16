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
            },
            name: "attach-no-os-lib",
            formats: ["es", "cjs"],
            fileName: (format, entryName) => format === 'es' ? `${entryName}.js` : `${entryName}.cjs`,
        },
        sourcemap: true,
        emptyOutDir: true,
        ssr: true,
    },
    define: {
        'import.meta.vitest': 'undefined',
    },
});
