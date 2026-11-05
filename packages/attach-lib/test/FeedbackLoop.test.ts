import { Attach, Result } from 'attach-lib';

import { binding, schema_paths, snapshot } from './bindings';

import { test, expect } from 'vitest';

test('adi,adis16475', async () => {
    const parsed = await Attach.parse(binding('iio/imu/adi,adis16475.yaml'), schema_paths);

    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }

    const attach = parsed.value;

    const data_1 = String.raw`{
            "compatible": ["adi,adis16500"]
        }`;

    const new_binding_1 = attach.update_binding_by_changes(data_1);

    expect.assert.isDefined(new_binding_1);

    await expect(snapshot(new_binding_1)).toMatchFileSnapshot('expected/feedback-loop/adi,adis16475-1.json');

    const data_2 = String.raw`{
            "compatible": ["adi,adis16575-2"]
        }`;

    const new_binding_2 = attach.update_binding_by_changes(data_2);

    expect.assert.isDefined(new_binding_2);

    await expect(snapshot(new_binding_2)).toMatchFileSnapshot('expected/feedback-loop/adi,adis16475-2.json');

    const data_3 = String.raw`{
            "compatible": ["adi,adis16575-2"],
            "adi,sync-mode" : 1
        }`;

    const new_binding_3 = attach.update_binding_by_changes(data_3);

    expect.assert.isDefined(new_binding_3);

    await expect(snapshot(new_binding_3)).toMatchFileSnapshot('expected/feedback-loop/adi,adis16475-3.json');

    // overlapping conditions
    const data_4 = String.raw`{
            "compatible": ["adi,adis16575-2"],
            "adi,sync-mode" : 3
        }`;

    const new_binding_4 = attach.update_binding_by_changes(data_4);

    expect.assert.isDefined(new_binding_4);

    await expect(snapshot(new_binding_4)).toMatchFileSnapshot('expected/feedback-loop/adi,adis16475-4.json');
});
