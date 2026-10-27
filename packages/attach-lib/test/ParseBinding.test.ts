import { Attach, Result } from 'attach-lib';

import { BINDINGS, binding, schema_paths, snapshot } from './bindings';

import { test, expect } from 'vitest';

// The ParsedBinding of each binding, as the CLI gets it
test.each(BINDINGS)('$name', async ({ name, path: file }) => {
    const parsed = await Attach.parse(file, schema_paths);
    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }

    await expect(snapshot(parsed.value.parsed_binding)).toMatchFileSnapshot(`expected/binding-parser/${name}.json`);
});

test('a binding that is not a valid schema (`$title` for `title`) is rejected', async () => {
    const parsed = await Attach.parse(binding('iio/amplifiers/adi,adl5580.yaml'), schema_paths);
    if (Result.is_ok(parsed)) { expect.fail('expected the parse to fail'); }

    expect(parsed.error).toMatchObject({ stage: 'validation', message: expect.stringContaining('$title') });
});
