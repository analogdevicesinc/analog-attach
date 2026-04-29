import path from 'node:path';
import * as fs from 'node:fs';

import { Attach } from 'attach-lib';

import { BindingTestData, write_to_directory } from './testing_utils';

import { test, expect } from 'vitest';

const adis16475: BindingTestData = {
    path: "schemas/iio/imu/adi,adis16475.yaml",
    name: "adi,adis16475",
    debug: false
} as const;

test(adis16475.name, async () => {
    const binding_path = path.resolve(__dirname, adis16475.path);
    const linux_path = path.resolve(__dirname, 'linux');
    const dt_schema_path = path.resolve(__dirname, 'dt-schema');

    const attach = Attach.new();

    const binding = await attach.parse_binding(binding_path, linux_path, dt_schema_path);

    expect.assert.isDefined(binding);

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

    expect(JSON.stringify(new_binding_1.binding)).toStrictEqual(expected_1);

    for (const error of new_binding_1.errors) {
        switch (error._t) {
            case 'missing_required': {
                if (!['reg', 'interrupts', 'spi-cpha', 'spi-cpol'].includes(error.missing_property)) {
                    expect.fail();
                }
                if (error.instance.length > 0) {
                    expect.fail();
                }
                break;
            }
            default: {
                expect.fail('Should have no other errors');
            }
        }
    }

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

    expect(JSON.stringify(new_binding_2.binding)).toStrictEqual(expected_2);

    for (const error of new_binding_2.errors) {
        switch (error._t) {
            case 'missing_required': {
                if (!['reg', 'interrupts', 'spi-cpha', 'spi-cpol'].includes(error.missing_property)) {
                    expect.fail();
                }
                break;
            }
            default: {
                expect.fail('Should have no other errors');
            }
        }
    }

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

    expect(JSON.stringify(new_binding_3.binding)).toStrictEqual(expected_3);

    for (const error of new_binding_3.errors) {
        switch (error._t) {
            case 'missing_required': {
                if (!['reg', 'interrupts', 'spi-cpha', 'spi-cpol'].includes(error.missing_property)) {
                    expect.fail(`Missing required ${error.msg}`);
                }
                break;
            }
            case 'failed_dependency': {
                expect(
                    error.dependent_property === "adi,sync-mode"
                    && error.missing_property === "clocks",
                    `Failed dependency`
                );

                break;
            }
            default: {
                expect.fail('Should have no other errors');
            }
        }
    }

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

    expect(JSON.stringify(new_binding_4.binding)).toStrictEqual(expected_4);

    for (const error of new_binding_4.errors) {
        switch (error._t) {
            case 'missing_required': {
                if (!['reg', 'interrupts', 'spi-cpha', 'spi-cpol'].includes(error.missing_property)) {
                    expect.fail(`Missing required ${error.msg}`);
                }
                break;
            }
            case 'failed_dependency': {
                expect(
                    error.dependent_property === "adi,sync-mode"
                    && error.missing_property === "clocks",
                    `Failed dependency`
                );

                break;
            }
            case 'number_limit': {
                expect(
                    error.failed_property.length === 1 &&
                    error.failed_property[0] === "adi,sync-mode" &&
                    error.comparison === '<=' &&
                    error.limit === 2,
                    `Failed number limit ${error.failed_property} ${error.msg}`
                );

                break;
            }
            default: {
                expect.fail('Should have no other errors');
            }
        }
    }
});

test('ad7124', async () => {
    const binding_path = path.resolve(__dirname, 'schemas/iio/adc/adi,ad7124.yaml');
    const linux_path = path.resolve(__dirname, 'linux');
    const dt_schema_path = path.resolve(__dirname, 'dt-schema');

    const attach = Attach.new();

    const binding = await attach.parse_binding(binding_path, linux_path, dt_schema_path);

    expect.assert.isDefined(binding);

    const data_1 = String.raw`{
            "compatible": ["adi,ad7124-8"],
            "reg" : [[0]],
            "channel@0":{
                "reg": [[0]]
            }
        }`;

    const new_binding = attach.update_binding_by_changes(data_1);

    expect.assert.isDefined(new_binding);

    expect(new_binding.errors.length).toStrictEqual(2);

    const first_error = new_binding.errors[0];

    expect(
        first_error._t === "missing_required" &&
        first_error.missing_property === "interrupts" &&
        first_error.instance.length === 0
    );

    const second_error = new_binding.errors[1];

    expect(
        second_error._t === "missing_required" &&
        second_error.missing_property === "diff-channels" &&
        second_error.instance.length === 1 &&
        second_error.instance[0] === "channel@0"
    );
});