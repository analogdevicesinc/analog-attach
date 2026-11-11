import { Attach, Result, DeviceTree, DeviceTreeOverlay, add_device_node } from 'attach-lib';

import { test, expect } from 'vitest';

import { binding, schema_paths } from './bindings';

test('a device whose reg is an enum goes at the lowest free address it allows', async () => {
    const parsed = await Attach.parse(binding('regulator/adi,adp5055-regulator.yaml'), schema_paths);
    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }
    const base = DeviceTree.new_from_string('/dts-v1/;\n/ {\n\ti2c1: i2c {\n\t\t#address-cells = <1>;\n\t\t#size-cells = <0>;\n\t};\n};');
    if (typeof base === 'string') { expect.fail(base); }
    const overlay = DeviceTreeOverlay.new_from_string('/dts-v1/;\n/plugin/;\n\n&i2c1 {\n};', base);
    if (typeof overlay === 'string') { expect.fail(overlay); }

    const request = { parent_path: '/i2c', name: 'adi,adp5055', compatible: 'adi,adp5055' };
    expect(add_device_node(overlay, request, parsed.value.parsed_binding)).toMatchObject({ status: 'added', key: 'adi,adp5055@70' });
    expect(add_device_node(overlay, request, parsed.value.parsed_binding)).toMatchObject({ status: 'added', key: 'adi,adp5055@71' });
    expect(overlay.print()).toMatch(/adi,adp5055@70 \{[^}]*reg = <112>/s);
});

test('a device whose reg is a range goes at the lowest free address in it', async () => {
    const parsed = await Attach.parse(binding('hwmon/adi,adm1266.yaml'), schema_paths);
    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }
    const base = DeviceTree.new_from_string('/dts-v1/;\n/ {\n\ti2c1: i2c {\n\t\t#address-cells = <1>;\n\t\t#size-cells = <0>;\n\t};\n};');
    if (typeof base === 'string') { expect.fail(base); }
    const overlay = DeviceTreeOverlay.new_from_string('/dts-v1/;\n/plugin/;\n\n&i2c1 {\n};', base);
    if (typeof overlay === 'string') { expect.fail(overlay); }

    expect(add_device_node(overlay, { parent_path: '/i2c', name: 'adi,adm1266', compatible: 'adi,adm1266' }, parsed.value.parsed_binding))
        .toMatchObject({ status: 'added', key: 'adi,adm1266@40', notes: [] });
});
