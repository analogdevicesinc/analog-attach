import { create_context, process_binding } from '../src/Bindings/index.js';
import { Result } from '../src/result.js';

import { BINDINGS, schema_paths, snapshot } from './bindings';

import { test, expect } from 'vitest';

// The schema of each binding after the fixups: what the validator compiles to narrow a node
test.each(BINDINGS)('$name', async ({ name, path: file }) => {
    const processed = await process_binding(file, create_context(schema_paths));
    if (Result.is_err(processed)) { expect.fail(`${processed.error.stage}: ${processed.error.message}`); }

    await expect(snapshot(processed.value)).toMatchFileSnapshot(`expected/JSONSchema-fixups/${name}.json`);
});
