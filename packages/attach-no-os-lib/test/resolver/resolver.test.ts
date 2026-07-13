import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { resolve_ruleset, load_resolved_ruleset } from '../../src/resolver/resolver';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import { RulesetStruct } from '../../src/ruleset_parser/types';
import { expectOk, setup_test_config, teardown_test_config, setup_no_config, teardown_no_config } from '../test_utilities';
import fs from 'node:fs';

const NOOS_ROOT = path.join(__dirname, '../bindings');
const SCHEMAS_ROOT = path.join(NOOS_ROOT, 'schemas');

describe('resolver', () => {
    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
    });

    afterEach(() => {
        teardown_test_config();
    });

    describe('resolve_ruleset', () => {
        test('resolves enum include to EnumProperty', () => {
            const content = fs.readFileSync(
                path.join(SCHEMAS_ROOT, 'platforms/xilinx/xil_spi_init_param.yaml'),
                'utf8'
            );
            const parsed = parse_ruleset(content);
            expectOk(parsed);

            const resolved = resolve_ruleset(parsed.value);
            expectOk(resolved);

            const struct = resolved.value as RulesetStruct;
            const type_property = struct.properties.find(p => p.name === 'type');

            expect(type_property).toBeDefined();
            expect(type_property!._t).toBe('EnumProperty');
            expect(type_property!._t === 'EnumProperty' && type_property.values).toContain('SPI_PS');
            expect(type_property!._t === 'EnumProperty' && type_property.values).toContain('SPI_PL');
            expect(type_property!._t === 'EnumProperty' && type_property.values).toContain('SPI_ENGINE');
        });

        test('keeps struct include as IncludeProperty', () => {
            const content = fs.readFileSync(
                path.join(SCHEMAS_ROOT, 'no-os/spi/no_os_spi_init_param.yaml'),
                'utf8'
            );
            const parsed = parse_ruleset(content);
            expectOk(parsed);

            const resolved = resolve_ruleset(parsed.value);
            expectOk(resolved);

            const struct = resolved.value as RulesetStruct;
            const mode_property = struct.properties.find(p => p.name === 'mode');

            expect(mode_property).toBeDefined();
            // mode includes an enum, so should become EnumProperty
            expect(mode_property!._t).toBe('EnumProperty');
        });

        test('non-struct rulesets pass through unchanged', () => {
            const content = fs.readFileSync(
                path.join(SCHEMAS_ROOT, 'no-os/enums/no_os_spi_mode.yaml'),
                'utf8'
            );
            const parsed = parse_ruleset(content);
            expectOk(parsed);

            const resolved = resolve_ruleset(parsed.value);
            expectOk(resolved);

            expect(resolved.value._t).toBe('RulesetEnum');
        });
    });

    describe('load_resolved_ruleset', () => {
        test('loads and resolves in one call', () => {
            const result = load_resolved_ruleset('platforms/xilinx/xil_spi_init_param.yaml');
            expectOk(result);

            const struct = result.value as RulesetStruct;
            const type_property = struct.properties.find(p => p.name === 'type');

            expect(type_property).toBeDefined();
            expect(type_property!._t).toBe('EnumProperty');
        });

        test('returns error for non-existent file', () => {
            const result = load_resolved_ruleset('nonexistent.yaml');
            expect(result.ok).toBe(false);
        });

        test('returns error if schemas_path not set', () => {
            setup_no_config();
            const result = load_resolved_ruleset('no-os/spi/no_os_spi_init_param.yaml');
            teardown_no_config();
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toContain('No global config');
            }
        });
    });
});
