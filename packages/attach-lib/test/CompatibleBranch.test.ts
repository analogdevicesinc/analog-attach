import path from 'node:path';

import { Attach, Result, DeviceTree, populate_binding, validator_input_json, type ParsedBinding } from 'attach-lib';

import { test, expect } from 'vitest';

/** The binding after a node with this body is narrowed. */
async function narrowed(binding: string, body: string): Promise<ParsedBinding | undefined> {
    const parsed = await Attach.parse(
        path.resolve(__dirname, 'linux/Documentation/devicetree/bindings', binding),
        { linux: path.resolve(__dirname, 'linux'), dt_schema: path.resolve(__dirname, 'dt-schema') },
    );
    if (Result.is_err(parsed)) { expect.fail(parsed.error.message); }
    const attach = parsed.value;

    const tree = DeviceTree.new_from_string(`/dts-v1/;\n/ { n: n@0 { ${body} }; };`);
    if (typeof tree === 'string') { expect.fail(tree); }
    const initial = populate_binding(attach.parsed_binding, tree, '{}', {});
    const node = tree.node_at('/n@0');
    if (node === undefined) { expect.fail('no node n@0'); }

    return attach.update_binding_by_changes(validator_input_json(node, initial.properties))?.binding;
}

/** The `required_properties` of the binding after a node with this body is narrowed. */
async function required_after(binding: string, body: string): Promise<readonly string[] | undefined> {
    return (await narrowed(binding, body))?.required_properties;
}

test('a single compatible takes the psci branch, like a list of three', async () => {
    const single = await required_after('arm/psci.yaml', 'compatible = "arm,psci";');
    expect(single).toEqual(expect.arrayContaining(['cpu_off', 'cpu_on']));

    const three = await required_after('arm/psci.yaml', 'compatible = "arm,psci-1.0", "arm,psci-0.2", "arm,psci";');
    expect(three).toEqual(expect.arrayContaining(['cpu_off', 'cpu_on']));
});

test('a then branch adds to the required properties of the binding', async () => {
    expect(await required_after('iio/dac/adi,ad5592r.yaml', 'compatible = "adi,ad5592r"; reg = <0>;'))
        .toEqual(['compatible', 'reg', '#address-cells', '#size-cells', 'spi-cpol']);
});

test('the else branch applies: it leaves the required properties and drops a property it forbids', async () => {
    const ad5592r = await narrowed('iio/dac/adi,ad5592r.yaml', 'compatible = "adi,ad5592r"; reg = <0>;');
    expect(ad5592r?.properties.map(property => property.key)).toContain('spi-cpol');

    const ad5593r = await narrowed('iio/dac/adi,ad5592r.yaml', 'compatible = "adi,ad5593r"; reg = <0x10>;');
    expect(ad5593r?.required_properties).toEqual(['compatible', 'reg', '#address-cells', '#size-cells']);
    expect(ad5593r?.properties.map(property => property.key)).not.toContain('spi-cpol');
});

test('a property the binding sets to false is not offered, even when a referenced schema defines it', async () => {
    const gcc = await narrowed('clock/qcom,gcc-msm8660.yaml', 'compatible = "qcom,gcc-msm8660"; #clock-cells = <1>;');
    expect(gcc?.properties.map(property => property.key)).toContain('#clock-cells');
    expect(gcc?.properties.map(property => property.key)).not.toContain('#power-domain-cells');
});
