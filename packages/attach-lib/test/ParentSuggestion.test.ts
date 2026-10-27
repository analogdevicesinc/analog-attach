import * as fs from 'node:fs';
import path from 'node:path';

import { Attach, DeviceTree, Result } from 'attach-lib';
import { suggest_parents } from '../src/Intelligence/parents.js';

import { test, expect } from 'vitest';

const rpi = DeviceTree.new_from_string(fs.readFileSync(path.resolve(__dirname, 'dts_source/rpi.prepro.dts'), 'utf8'));
if (typeof rpi === 'string') { throw new TypeError(`Failed to parse rpi.prepro.dts: ${rpi}`); }

const spi = ['spi', 'spi1', 'spi2', 'spi3', 'spi4', 'spi5', 'spi6'];
const i2c = ['i2c0if', 'i2c1', 'i2c3', 'i2c4', 'i2c5', 'i2c6'];

// The parents the rpi-4-b tree offers a binding, by its kind of device
test.each([
    ['an SPI device', 'iio/adc/adi,ad7124.yaml', spi],
    ['a device with an SPI and an I2C interface', 'iio/accel/adi,adxl345.yaml', [...spi, ...i2c]],
    ['a fixed clock', 'clock/fixed-clock.yaml', ['clocks']],
    ['a fixed regulator', 'regulator/regulator-fixed.yaml', ['/']],
    ['a memory-mapped device (no bus to suggest)', 'iio/adc/st,stm32-adc.yaml', []],
])('%s (%s)', async (_kind, binding, labels) => {
    const parsed = await Attach.parse(path.resolve(__dirname, 'schemas', binding), {
        linux: path.resolve(__dirname, 'linux'),
        dt_schema: path.resolve(__dirname, 'dt-schema'),
    });
    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }

    expect(suggest_parents(rpi, parsed.value.parsed_binding).map(parent => parent.label)).toStrictEqual(labels);
});
