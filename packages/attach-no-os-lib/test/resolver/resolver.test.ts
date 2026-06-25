import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { resolve_ruleset, load_resolved_binding } from '../../src/resolver/resolver';
import { set_schemas_path, reset_settings } from '../../src/settings/settings';
import { parse_binding } from '../../src/bindings_parser/binding_parser';
import { RulesetStruct } from '../../src/bindings_parser/types';
import { expectOk } from '../test_utils';
import * as fs from 'node:fs';

const SCHEMAS_ROOT = path.join(__dirname, '../bindings/schemas');

describe('resolver', () => {
    beforeEach(() => {
        set_schemas_path(SCHEMAS_ROOT);
    });

    afterEach(() => {
        reset_settings();
    });

    describe('resolve_ruleset', () => {
        test('resolves enum include to EnumProperty', () => {
            const content = fs.readFileSync(
                path.join(SCHEMAS_ROOT, 'platforms/xilinx/xil_spi_init_param.yaml'),
                'utf8'
            );
            const parsed = parse_binding(content);
            expectOk(parsed);

            const resolved = resolve_ruleset(parsed.value);
            expectOk(resolved);

            const struct = resolved.value as RulesetStruct;
            const type_prop = struct.properties.find(p => p.name === 'type');

            expect(type_prop).toBeDefined();
            expect(type_prop!._t).toBe('EnumProperty');
            expect(type_prop!._t === 'EnumProperty' && type_prop.values).toContain('SPI_PS');
            expect(type_prop!._t === 'EnumProperty' && type_prop.values).toContain('SPI_PL');
            expect(type_prop!._t === 'EnumProperty' && type_prop.values).toContain('SPI_ENGINE');
        });

        test('keeps struct include as IncludeProperty', () => {
            const content = fs.readFileSync(
                path.join(SCHEMAS_ROOT, 'no-os/no_os_spi_init_param.yaml'),
                'utf8'
            );
            const parsed = parse_binding(content);
            expectOk(parsed);

            const resolved = resolve_ruleset(parsed.value);
            expectOk(resolved);

            const struct = resolved.value as RulesetStruct;
            const mode_prop = struct.properties.find(p => p.name === 'mode');

            expect(mode_prop).toBeDefined();
            // mode includes an enum, so should become EnumProperty
            expect(mode_prop!._t).toBe('EnumProperty');
        });

        test('non-struct rulesets pass through unchanged', () => {
            const content = fs.readFileSync(
                path.join(SCHEMAS_ROOT, 'no-os/enums/no_os_spi_mode.yaml'),
                'utf8'
            );
            const parsed = parse_binding(content);
            expectOk(parsed);

            const resolved = resolve_ruleset(parsed.value);
            expectOk(resolved);

            expect(resolved.value._t).toBe('BindingEnum');
        });
    });

    describe('load_resolved_binding', () => {
        test('loads and resolves in one call', () => {
            const result = load_resolved_binding('platforms/xilinx/xil_spi_init_param.yaml');
            expectOk(result);

            const struct = result.value as RulesetStruct;
            const type_prop = struct.properties.find(p => p.name === 'type');

            expect(type_prop).toBeDefined();
            expect(type_prop!._t).toBe('EnumProperty');
        });

        test('returns error for non-existent file', () => {
            const result = load_resolved_binding('nonexistent.yaml');
            expect(result.ok).toBe(false);
        });

        test('returns error if schemas_path not set', () => {
            reset_settings();
            const result = load_resolved_binding('no-os/no_os_spi_init_param.yaml');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toContain('Schemas path not configured');
            }
        });
    });
});
