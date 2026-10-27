import path from 'node:path';

import type { SchemaPaths } from 'attach-lib';

/** The trees the bindings are resolved against: the `test/linux` and `test/dt-schema` checkouts. */
export const schema_paths: SchemaPaths = {
    linux: path.resolve(__dirname, 'linux'),
    dt_schema: path.resolve(__dirname, 'dt-schema'),
};

/** The path of a binding in the Linux tree, from `Documentation/devicetree/bindings`. */
export const binding = (file: string): string => path.join(schema_paths.linux, 'Documentation/devicetree/bindings', file);

/** The bindings the snapshot suites run on, by the name of their snapshot. */
export const BINDINGS: { name: string, path: string }[] = [
    { name: 'adi,adxl345', path: 'iio/accel/adi,adxl345.yaml' },
    { name: 'adi,adxl355', path: 'iio/accel/adi,adxl355.yaml' },
    { name: 'adi,adxl380', path: 'iio/accel/adi,adxl380.yaml' },
    { name: 'adi,ad7124', path: 'iio/adc/adi,ad7124.yaml' },
    { name: 'adi,ad4130', path: 'iio/adc/adi,ad4130.yaml' },
    { name: 'adi,ad4134', path: 'iio/adc/adi,ad4134.yaml' },
    { name: 'adi,ad7292', path: 'iio/adc/adi,ad7292.yaml' },
    { name: 'adi,ad7923', path: 'iio/adc/adi,ad7923.yaml' },
    { name: 'adi,ad7768', path: 'iio/adc/adi,ad7768.yaml' },
    { name: 'st,stm32-adc', path: 'iio/adc/st,stm32-adc.yaml' },
    { name: 'ad3552r', path: 'iio/dac/adi,ad3552r.yaml' },
    { name: 'adi,adis16475', path: 'iio/imu/adi,adis16475.yaml' },
    { name: 'adi,ad2s90', path: 'iio/resolver/adi,ad2s90.yaml' },
    { name: 'fixed-clock', path: 'clock/fixed-clock.yaml' },
    { name: 'regulator-fixed', path: 'regulator/fixed-regulator.yaml' },
].map(({ name, path: file }) => ({ name, path: binding(file) }));

function stable(value: unknown): unknown {
    if (typeof value === 'bigint') { return `${value}n`; }
    if (Array.isArray(value)) { return value.map(item => stable(item)); }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])]));
    }
    return value;
}

/**
 * The JSON a snapshot holds: keys sorted, so a change of their order isn't a change, and bigints as `"<n>n"`, so a
 * bigint that becomes a number is one. `vitest -u` rewrites the snapshots.
 */
export const snapshot = (value: unknown): string => `${JSON.stringify(stable(value), undefined, 4)}\n`;
