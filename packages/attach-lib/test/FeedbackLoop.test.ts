import path from 'node:path';
import * as fs from 'node:fs';

import { Attach, Result } from 'attach-lib';
import type { BindingErrors } from '../src/Attach/Errors.js';

import { BindingTestData, write_to_directory, bigIntReplacer } from './testing_utils';

import { test, expect } from 'vitest';

const adis16475: BindingTestData = {
    path: "schemas/iio/imu/adi,adis16475.yaml",
    name: "adi,adis16475",
    debug: false
} as const;

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

test(adis16475.name, async () => {
    const binding_path = path.resolve(__dirname, adis16475.path);
    const linux_path = path.resolve(__dirname, 'linux');
    const dt_schema_path = path.resolve(__dirname, 'dt-schema');

    const parsed = await Attach.parse(binding_path, { linux: linux_path, dt_schema: dt_schema_path });

    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }

    const attach = parsed.value;

    const data_1 = String.raw`{
            "compatible": ["adi,adis16500"]
        }`;

    const new_binding_1 = attach.update_binding_by_changes(data_1);

    expect.assert.isDefined(new_binding_1);

    if (adis16475.debug === true) {
        write_to_directory(
            path.resolve(__dirname, "expected/feedback-loop"),
            `${adis16475.name}-1`,
            new_binding_1.binding
        );
    }

    const expected_1_path = path.resolve(__dirname, `expected/feedback-loop/${adis16475.name}-1.json`);
    const expected_1 = JSON.stringify(JSON.parse(fs.readFileSync(expected_1_path, 'utf8')));

    expect(JSON.stringify(new_binding_1.binding, bigIntReplacer)).toStrictEqual(expected_1);

    expect(summary(new_binding_1.errors)).toEqual(adis_missing);

    const data_2 = String.raw`{
            "compatible": ["adi,adis16575-2"]
        }`;

    const new_binding_2 = attach.update_binding_by_changes(data_2);

    expect.assert.isDefined(new_binding_2);

    if (adis16475.debug === true) {
        write_to_directory(
            path.resolve(__dirname, "expected/feedback-loop"),
            `${adis16475.name}-2`,
            new_binding_2.binding
        );
    }

    const expected_2_path = path.resolve(__dirname, `expected/feedback-loop/${adis16475.name}-2.json`);
    const expected_2 = JSON.stringify(JSON.parse(fs.readFileSync(expected_2_path, 'utf8')));

    expect(JSON.stringify(new_binding_2.binding, bigIntReplacer)).toStrictEqual(expected_2);

    expect(summary(new_binding_2.errors)).toEqual(adis_missing);

    const data_3 = String.raw`{
            "compatible": ["adi,adis16575-2"],
            "adi,sync-mode" : 1
        }`;

    const new_binding_3 = attach.update_binding_by_changes(data_3);

    expect.assert.isDefined(new_binding_3);

    if (adis16475.debug === true) {
        write_to_directory(
            path.resolve(__dirname, "expected/feedback-loop"),
            `${adis16475.name}-3`,
            new_binding_3.binding
        );
    }

    const expected_3_path = path.resolve(__dirname, `expected/feedback-loop/${adis16475.name}-3.json`);
    const expected_3 = JSON.stringify(JSON.parse(fs.readFileSync(expected_3_path, 'utf8')));

    expect(JSON.stringify(new_binding_3.binding, bigIntReplacer)).toStrictEqual(expected_3);

    expect(summary(new_binding_3.errors)).toEqual(['adi,sync-mode needs clocks', ...adis_missing]);

    // overlapping conditions
    const data_4 = String.raw`{
            "compatible": ["adi,adis16575-2"],
            "adi,sync-mode" : 3
        }`;

    const new_binding_4 = attach.update_binding_by_changes(data_4);

    expect.assert.isDefined(new_binding_4);

    if (adis16475.debug === true) {
        write_to_directory(
            path.resolve(__dirname, "expected/feedback-loop"),
            `${adis16475.name}-4`,
            new_binding_4.binding
        );
    }

    const expected_4_path = path.resolve(__dirname, `expected/feedback-loop/${adis16475.name}-4.json`);
    const expected_4 = JSON.stringify(JSON.parse(fs.readFileSync(expected_4_path, 'utf8')));

    expect(JSON.stringify(new_binding_4.binding, bigIntReplacer)).toStrictEqual(expected_4);

    expect(summary(new_binding_4.errors)).toEqual(['adi,sync-mode <= 2', 'adi,sync-mode needs clocks', ...adis_missing]);
});

test('ad7124', async () => {
    const binding_path = path.resolve(__dirname, 'schemas/iio/adc/adi,ad7124.yaml');
    const linux_path = path.resolve(__dirname, 'linux');
    const dt_schema_path = path.resolve(__dirname, 'dt-schema');

    const parsed = await Attach.parse(binding_path, { linux: linux_path, dt_schema: dt_schema_path });

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