import { Attach, Result } from 'attach-lib';

import { BINDINGS, binding, schema_paths, snapshot } from './bindings';

import { test, expect } from 'vitest';

// The ParsedBinding of each binding, as the CLI gets it
test.each(BINDINGS)('$name', async ({ name, path: file }) => {
    const parsed = await Attach.parse(file, schema_paths);
    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }

    await expect(snapshot(parsed.value.parsed_binding)).toMatchFileSnapshot(`expected/binding-parser/${name}.json`);
});

// dt-mk-schema takes it, and dt-validate checks a node against it
test('a binding with a keyword JSON Schema doesn\'t know (`$title` for `title`) is parsed', async () => {
    const parsed = await Attach.parse(binding('iio/amplifiers/adi,adl5580.yaml'), schema_paths);
    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }

    expect(parsed.value.parsed_binding.properties.map(p => p.key)).toContain('compatible');
});
