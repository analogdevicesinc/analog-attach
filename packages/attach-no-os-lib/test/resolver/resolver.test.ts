import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { resolve_ruleset, load_resolved_ruleset } from '../../src/resolver/resolver';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import { resolve_entry } from '../../src/registry/registry';
import { RulesetStruct } from '../../src/ruleset_parser/types';
import {
    expectErrorContains,
    expectOk,
    setup_test_config,
    teardown_test_config,
    setup_no_config,
    teardown_no_config,
} from '../test_utilities';

// Resolution follows a ruleset's `include:` references, each of which names a bare symbol.
// Its one transformation is lowering an include-of-an-enum into an EnumProperty, so a
// consumer sees a value set rather than a reference to chase.

function fixture(symbol: string) {
    const entry = resolve_entry(symbol);
    expectOk(entry);
    const parsed = parse_ruleset(fs.readFileSync(entry.value.file, 'utf8'));
    expectOk(parsed);
    return parsed.value;
}

describe('resolver', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    describe('resolve_ruleset', () => {
        test('an include of an enum is lowered to an EnumProperty', () => {
            const resolved = resolve_ruleset(fixture('test_spi_device'));
            expectOk(resolved);

            const mode = (resolved.value as RulesetStruct).properties.find(p => p.name === 'mode');
            expect(mode?._t).toBe('EnumProperty');
            expect(mode?._t === 'EnumProperty' && mode.values).toEqual(['TEST_SPI_MODE_0', 'TEST_SPI_MODE_3']);
            // The enum's own default comes along, so the including field needs no copy of it.
            expect(mode?._t === 'EnumProperty' && mode.default).toBe('TEST_SPI_MODE_0');
        });

        test('an include of anything else stays a reference', () => {
            const resolved = resolve_ruleset(fixture('test_spi_device'));
            expectOk(resolved);

            const controller = (resolved.value as RulesetStruct).properties.find(p => p.name === 'controller');
            expect(controller?._t).toBe('IncludeProperty');
            expect(controller?._t === 'IncludeProperty' && controller.include).toBe('test_spi_controller');
        });

        test('a non-struct passes through unchanged', () => {
            const resolved = resolve_ruleset(fixture('test_spi_mode'));
            expectOk(resolved);
            expect(resolved.value._t).toBe('RulesetEnum');
        });

        test('a descriptor resolves by checking its $init_param names a struct', () => {
            const resolved = resolve_ruleset(fixture('test_spi_controller'));
            expectOk(resolved);
            expect(resolved.value._t).toBe('RulesetDescriptor');
        });
    });

    describe('load_resolved_ruleset', () => {
        test('loads and resolves in one call, by symbol', () => {
            const result = load_resolved_ruleset('test_spi_device');
            expectOk(result);

            const mode = (result.value as RulesetStruct).properties.find(p => p.name === 'mode');
            expect(mode?._t).toBe('EnumProperty');
        });

        test('reaches across modules, since a symbol names no location', () => {
            // testpart_init_param is in the driver collection; its union member points at a
            // struct in the interface module.
            const result = load_resolved_ruleset('testpart_init_param');
            expectOk(result);
        });

        test('an unknown symbol is an error that names it', () => {
            expectErrorContains(load_resolved_ruleset('no_such_symbol'), "Unknown ruleset 'no_such_symbol'");
        });

        test('an unconfigured root is reported as the unset setting it is', () => {
            // A missing config file is not an error in itself - attach-meta reads the
            // settings before anything is configured - so the failure is the unset setting.
            setup_no_config();
            const result = load_resolved_ruleset('test_spi_device');
            teardown_no_config();
            expectErrorContains(result, '"capi_path" is not configured');
        });
    });
});
