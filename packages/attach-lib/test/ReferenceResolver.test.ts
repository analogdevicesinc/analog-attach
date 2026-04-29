import path from 'node:path';
import * as fs from 'node:fs';

import { resolve_references } from 'attach-lib';
import $RefParser from '@apidevtools/json-schema-ref-parser';

import { BindingTestData, write_to_directory } from './testing_utils';

import { describe, test, expect } from 'vitest';

describe('Reference Resolver Test', () => {
    const adxl345: BindingTestData = {
        path: 'schemas/iio/accel/adi,adxl345.yaml',
        name: "adi,adxl345",
        debug: false
    };

    test(adxl345.name, async () => {
        await test_impl(adxl345);
    });


    const adxl355: BindingTestData = {
        path: "schemas/iio/accel/adi,adxl355.yaml",
        name: "adi,adxl355",
        debug: false
    } as const;

    test(adxl355.name, async () => {
        await test_impl(adxl355);
    });


    const adxl380: BindingTestData = {
        path: 'schemas/iio/accel/adi,adxl380.yaml',
        name: "adi,adxl380",
        debug: false
    };

    test(adxl380.name, async () => {
        await test_impl(adxl380);
    });


    const ad7124: BindingTestData = {
        path: "schemas/iio/adc/adi,ad7124.yaml",
        name: "adi,ad7124",
        debug: false
    } as const;

    test(ad7124.name, async () => {
        await test_impl(ad7124);
    });


    const ad4130: BindingTestData = {
        path: "schemas/iio/adc/adi,ad4130.yaml",
        name: "adi,ad4130",
        debug: false
    } as const;

    test(ad4130.name, async () => {
        await test_impl(ad4130);
    });


    const ad4134: BindingTestData = {
        path: "schemas/iio/adc/adi,ad4134.yaml",
        name: "adi,ad4134",
        debug: false
    } as const;

    test(ad4134.name, async () => {
        await test_impl(ad4134);
    });


    const ad7292: BindingTestData = {
        path: 'schemas/iio/adc/adi,ad7292.yaml',
        name: "adi,ad7292",
        debug: false
    };

    test(ad7292.name, async () => {
        await test_impl(ad7292);
    });


    const ad7923: BindingTestData = {
        path: 'schemas/iio/adc/adi,ad7923.yaml',
        name: "adi,ad7923",
        debug: false
    };

    test(ad7923.name, async () => {
        await test_impl(ad7923);
    });


    const ad7768: BindingTestData = {
        path: 'schemas/iio/adc/adi,ad7768.yaml',
        name: "adi,ad7768",
        debug: false
    };

    test(ad7768.name, async () => {
        await test_impl(ad7768);
    });


    const stm32_adc: BindingTestData = {
        path: 'schemas/iio/adc/st,stm32-adc.yaml',
        name: "st,stm32-adc",
        debug: false
    };

    test(stm32_adc.name, async () => {
        await test_impl(stm32_adc);
    });


    const ad3552r: BindingTestData = {
        path: 'schemas/iio/dac/adi,ad3552r.yaml',
        name: "ad3552r",
        debug: false
    };

    test(ad3552r.name, async () => {
        await test_impl(ad3552r);
    });


    const adis16475: BindingTestData = {
        path: "schemas/iio/imu/adi,adis16475.yaml",
        name: "adi,adis16475",
        debug: false
    } as const;

    test(adis16475.name, async () => {
        await test_impl(adis16475);
    });


    const adl5580: BindingTestData = {
        path: 'schemas/iio/amplifiers/adi,adl5580.yaml',
        name: "adi,adl5580",
        debug: false
    };

    test.todo(adl5580.name, async () => {
        await test_impl(adl5580);
    });


    const ad2s90: BindingTestData = {
        path: 'schemas/iio/resolver/adi,ad2s90.yaml',
        name: "adi,ad2s90",
        debug: false
    };

    test(ad2s90.name, async () => {
        await test_impl(ad2s90);
    });


    const fixed_clock: BindingTestData = {
        path: 'schemas/clock/fixed-clock.yaml',
        name: "fixed-clock",
        debug: false
    };

    test(fixed_clock.name, async () => {
        await test_impl(fixed_clock);
    });


    const regulator_fixed: BindingTestData = {
        path: 'schemas/regulator/regulator-fixed.yaml',
        name: "regulator-fixed",
        debug: false
    };

    test(regulator_fixed.name, async () => {
        await test_impl(regulator_fixed);
    });
});

async function test_impl(data: BindingTestData) {
    const binding_path = path.resolve(__dirname, data.path);
    const linux_path = path.resolve(__dirname, 'linux');
    const dt_schema_path = path.resolve(__dirname, 'dt-schema');

    const reference_parser = new $RefParser;

    const reference_resolved = await resolve_references(binding_path, reference_parser, linux_path, dt_schema_path);

    if (typeof reference_resolved === 'string') {
        console.log(reference_resolved);
        expect.fail();
    }

    if (data.debug === true) {
        write_to_directory(
            path.resolve(__dirname, "expected/ref-resolver"),
            data.name,
            reference_resolved.root_binding
        );
    }

    const expected_path = path.resolve(__dirname, `expected/ref-resolver/${data.name}.json`);
    const expected = JSON.stringify(JSON.parse(fs.readFileSync(expected_path, { encoding: 'utf8' })));

    expect(JSON.stringify(reference_resolved.root_binding)).toStrictEqual(expected);
} 