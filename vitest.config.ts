import { defineProject } from 'vitest/config';

export default defineProject({
    test: {
        projects: ['packages/attach-lib/vitest.config.ts', 'packages/attach-cli/vitest.config.ts']
    },
});