import path from 'node:path';

import { Attach, Result, type ParsedBinding } from 'attach-lib';

import { describe, test, expect } from 'vitest';

const linux_path = path.resolve(__dirname, 'linux');
const dt_schema_path = path.resolve(__dirname, 'dt-schema');

async function parse(binding: string): Promise<ParsedBinding> {
    const result = await Attach.parse(
        path.join(linux_path, 'Documentation/devicetree/bindings', binding),
        { linux: linux_path, dt_schema: dt_schema_path },
    );
    if (Result.is_err(result)) { expect.fail(result.error.message); }
    return result.value.parsed_binding;
}

describe('patternProperties without inline properties', () => {
    test('property patterns keep their description and type', async () => {
        const binding = await parse('hwmon/adt7475.yaml');
        const patterns = binding.property_patterns ?? [];
        expect(patterns.map(p => p.pattern)).toEqual([
            '^adi,bypass-attenuator-in[0-4]$',
            '^adi,pin(5|10)-function$',
            '^adi,pin(9|14)-function$',
        ]);
        const bypass = patterns[0];
        expect(bypass?.description).toContain('bypassing the individual voltage input attenuator');
        expect(bypass?.value).toMatchObject({ _t: 'scalar', cell: { _t: 'enum', enum: [BigInt(0), BigInt(1)] } });
        // Property patterns are not child-node rules.
        expect(binding.pattern_properties?.map(p => p.pattern)).toEqual(['^fan-[0-9]+$']);
    });

    test('property patterns get the fixups of named properties', async () => {
        const binding = await parse('hwmon/adt7475.yaml');
        const pin5 = binding.property_patterns?.find(p => p.pattern === '^adi,pin(5|10)-function$');
        expect(pin5?.value._t).not.toBe('unknown');
        expect(JSON.stringify(pin5?.value)).toContain('"smbalert#"');
    });

    test('flag patterns are booleans', async () => {
        const binding = await parse('sound/realtek,rt5677.yaml');
        expect(binding.property_patterns?.find(p => p.pattern === '^realtek,in[1-2]-differential$')?.value)
            .toMatchObject({ _t: 'flag' });
    });

    test('a bare `type: object` pattern is a child node with no known properties', async () => {
        const binding = await parse('display/tegra/nvidia,tegra186-display.yaml');
        expect(binding.pattern_properties?.find(p => p.pattern === '^display@[0-9a-f]+$'))
            .toEqual({ pattern: '^display@[0-9a-f]+$', description: '', properties: [], required: [] });
        expect(binding.property_patterns ?? []).toEqual([]);
    });

    test('a oneOf of object schemas is a child node', async () => {
        const binding = await parse('pinctrl/qcom,msm8974-pinctrl.yaml');
        expect(binding.pattern_properties?.map(p => p.pattern)).toContain('-state$');
        expect(binding.property_patterns?.map(p => p.pattern) ?? []).not.toContain('-state$');
    });

    test('a pattern set to false forbids nodes and is left out', async () => {
        const binding = await parse('interrupt-controller/arm,gic-v3.yaml');
        const all = [...(binding.pattern_properties ?? []), ...(binding.property_patterns ?? [])].map(p => p.pattern);
        expect(all).not.toContain('^gic-its@');
    });
});
