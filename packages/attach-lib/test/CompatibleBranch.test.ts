import path from 'node:path';

import { Attach, Result, DeviceTree, populate_binding, validator_input_json } from 'attach-lib';

import { test, expect } from 'vitest';

/** The `required_properties` of the binding after a node with this body is narrowed. */
async function required_after(binding: string, body: string): Promise<readonly string[] | undefined> {
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

    return attach.update_binding_by_changes(validator_input_json(node, initial.properties))?.binding.required_properties;
}

test('a single compatible takes the psci branch, like a list of three', async () => {
    const single = await required_after('arm/psci.yaml', 'compatible = "arm,psci";');
    expect(single).toEqual(expect.arrayContaining(['cpu_off', 'cpu_on']));

    const three = await required_after('arm/psci.yaml', 'compatible = "arm,psci-1.0", "arm,psci-0.2", "arm,psci";');
    expect(three).toEqual(expect.arrayContaining(['cpu_off', 'cpu_on']));
});
