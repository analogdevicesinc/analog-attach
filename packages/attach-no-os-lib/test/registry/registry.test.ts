import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { get_registry, resolve_entry, all_symbols, is_platform_symbol } from '../../src/registry/registry';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import { RulesetType } from '../../src/ruleset_parser/types';
import {
    expectError,
    expectErrorContains,
    expectOk,
    setup_test_config,
    teardown_test_config,
    FIXTURE_CAPI,
    FIXTURE_DRIVERS,
    FIXTURE_PLATFORM,
} from '../test_utilities';

// A ruleset's identity is its $symbol, and `include:`/`$compatible` name that symbol rather
// than a path. Something has to turn a symbol into a file: that is the registry, built from
// the configured module roots by walking each one's declared module graph.

describe('registry', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('walks the declared module graph, not the directory tree', () => {
        const registry = get_registry();
        expectOk(registry);

        // capi, the platform and its boards are NOT walked (boards carry no rulesets), the
        // collection, its one category and its one driver are.
        const names = registry.value.modules.map(module => module.name).sort();
        expect(names).toEqual(['capi-test', 'drivers-test', 'platform-test', 'sensor', 'testpart']);
    });

    test('indexes every symbol its indexes list, and nothing else', () => {
        const symbols = all_symbols();
        expectOk(symbols);

        expect(symbols.value.map(entry => entry.$symbol)).toEqual([
            'test_array_holder',
            'test_gpio_ops',
            'test_gpio_pin',
            'test_spi_config',
            'test_spi_controller',
            'test_spi_device',
            'test_spi_extra',
            'test_spi_mode',
            'test_spi_ops',
            'testpart_comm_type',
            'testpart_init_param',
            'testpart_ops',
        ]);
    });

    test('an entry carries the file, the module that ships it, and its kind', () => {
        const entry = resolve_entry('testpart_init_param');
        expectOk(entry);

        expect(entry.value.module.name).toBe('testpart');
        expect(entry.value.$type).toBe(RulesetType.RT_STRUCT);
        expect(entry.value.file.startsWith(FIXTURE_DRIVERS)).toBe(true);
        // The owning module is the back-pointer that replaced each ruleset's own $sources
        // and $config: build facts belong to the module, not to the symbol.
        expect(entry.value.module.build?.kconfig).toBe('TESTPART');
    });

    test('resolves across repositories, because a symbol names no location', () => {
        // testpart_init_param lives in the driver collection and its union member reaches
        // test_spi_device in capi, with neither side knowing where the other is checked out.
        const resolved = load_resolved_ruleset('testpart_init_param');
        expectOk(resolved);

        const owner = resolve_entry('test_spi_device');
        expectOk(owner);
        expect(owner.value.module.name).toBe('capi-test');
    });

    test('an unknown symbol says so, naming what was asked for', () => {
        const entry = resolve_entry('no_such_symbol');
        expectErrorContains(entry, "Unknown ruleset 'no_such_symbol'");
    });

    test('a symbol claimed by two files is a collision, not a precedence question', () => {
        // The same root twice: every symbol in it is then defined twice over.
        setup_test_config({ modules: [FIXTURE_CAPI] });
        const registry = get_registry();
        expectError(registry);
        expect(registry.error.message).toContain('is defined twice');
    });

    test('a platform module is what makes a symbol platform-specific', () => {
        // Provenance is the module that ships the symbol, not a directory convention: the
        // same struct shape is platform-specific or not depending only on who declared it.
        expect(is_platform_symbol('test_spi_extra')).toBe(true);
        expect(is_platform_symbol('test_spi_config')).toBe(false);
        expect(is_platform_symbol('no_such_symbol')).toBe(false);
    });

    test('a root with no module.yml is refused by name', () => {
        setup_test_config({ capi: path.join(FIXTURE_PLATFORM, 'boards') });
        const registry = get_registry();
        expectErrorContains(registry, 'No module.yml at module root');
    });
});
