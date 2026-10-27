import { Attach, Result } from 'attach-lib';
import type { BindingErrors } from '../src/Attach/Errors.js';

import { binding, schema_paths, snapshot } from './bindings';

import { test, expect } from 'vitest';

/** The errors of a narrowing as short, sorted descriptions, so a test names every error it expects. */
function summary(errors: BindingErrors[]): string[] {
    return errors.map(error => {
        switch (error._t) {
            case 'missing_required': { return `missing ${error.missing_property}${error.instance.length > 0 ? ` in ${error.instance.join('/')}` : ''}`; }
            case 'failed_dependency': { return `${error.dependent_property} needs ${error.missing_property}`; }
            case 'number_limit': { return `${error.failed_property.join('/')} ${error.comparison} ${error.limit}`; }
            case 'generic': { return `generic ${error.origin}`; }
        }
    }).sort();
}

const adis_missing = ['missing interrupts', 'missing reg', 'missing spi-cpha', 'missing spi-cpol'];

test('adi,adis16475', async () => {
    const parsed = await Attach.parse(binding('iio/imu/adi,adis16475.yaml'), schema_paths);

    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }

    const attach = parsed.value;

    const data_1 = String.raw`{
            "compatible": ["adi,adis16500"]
        }`;

    const new_binding_1 = attach.update_binding_by_changes(data_1);

    expect.assert.isDefined(new_binding_1);

    await expect(snapshot(new_binding_1.binding)).toMatchFileSnapshot('expected/feedback-loop/adi,adis16475-1.json');

    expect(summary(new_binding_1.errors)).toEqual(adis_missing);

    const data_2 = String.raw`{
            "compatible": ["adi,adis16575-2"]
        }`;

    const new_binding_2 = attach.update_binding_by_changes(data_2);

    expect.assert.isDefined(new_binding_2);

    await expect(snapshot(new_binding_2.binding)).toMatchFileSnapshot('expected/feedback-loop/adi,adis16475-2.json');

    expect(summary(new_binding_2.errors)).toEqual(adis_missing);

    const data_3 = String.raw`{
            "compatible": ["adi,adis16575-2"],
            "adi,sync-mode" : 1
        }`;

    const new_binding_3 = attach.update_binding_by_changes(data_3);

    expect.assert.isDefined(new_binding_3);

    await expect(snapshot(new_binding_3.binding)).toMatchFileSnapshot('expected/feedback-loop/adi,adis16475-3.json');

    expect(summary(new_binding_3.errors)).toEqual(['adi,sync-mode needs clocks', ...adis_missing]);

    // overlapping conditions
    const data_4 = String.raw`{
            "compatible": ["adi,adis16575-2"],
            "adi,sync-mode" : 3
        }`;

    const new_binding_4 = attach.update_binding_by_changes(data_4);

    expect.assert.isDefined(new_binding_4);

    await expect(snapshot(new_binding_4.binding)).toMatchFileSnapshot('expected/feedback-loop/adi,adis16475-4.json');

    expect(summary(new_binding_4.errors)).toEqual(['adi,sync-mode <= 2', 'adi,sync-mode needs clocks', ...adis_missing]);
});

test('ad7124', async () => {
    const parsed = await Attach.parse(binding('iio/adc/adi,ad7124.yaml'), schema_paths);

    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }

    const attach = parsed.value;

    const data_1 = String.raw`{
            "compatible": ["adi,ad7124-8"],
            "reg" : [[0]],
            "channel@0":{
                "reg": [[0]]
            }
        }`;

    const new_binding = attach.update_binding_by_changes(data_1);

    expect.assert.isDefined(new_binding);

    expect(summary(new_binding.errors)).toEqual(['missing diff-channels in channel@0', 'missing interrupts']);
});