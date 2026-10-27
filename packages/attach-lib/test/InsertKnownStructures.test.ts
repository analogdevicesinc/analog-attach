import * as fs from 'node:fs';
import path from 'node:path';

import { Attach, DeviceTree, Result, populate_binding } from 'attach-lib';

import { BINDINGS, schema_paths, snapshot } from './bindings';

import { test, expect } from 'vitest';

const rpi = DeviceTree.new_from_string(fs.readFileSync(path.resolve(__dirname, 'dts_source/rpi.prepro.dts'), 'utf8'));
if (typeof rpi === 'string') { throw new TypeError(`Failed to parse rpi.prepro.dts: ${rpi}`); }

// Each binding populated for a node under the rpi's spi@7e204000
test.each(BINDINGS)('$name', async ({ name, path: file }) => {
    const parsed = await Attach.parse(file, schema_paths);
    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }

    const populated = populate_binding(parsed.value.parsed_binding, rpi, '{}', { parent_name: 'spi@7e204000' });

    await expect(snapshot(populated)).toMatchFileSnapshot(`expected/insert-known-structures/${name}.json`);
});
