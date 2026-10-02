import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { board_externs, find_board_extern, check_bsp_kinds } from '../../src/registry/bsp';
import { resolve_entry } from '../../src/registry/registry';
import { load_resolved_ruleset, load_resolved_ruleset_for_board } from '../../src/resolver/resolver';
import { expectErrorContains, expectOk, setup_test_config, teardown_test_config, FIXTURE_BOARD } from '../test_utilities';

// An application references the peripherals its board's BSP already defines rather than
// constructing them, so each board.yml entry becomes an extern. They are scoped to ONE
// board because the names are shared on purpose: `bsp_test_spi_cfg` is declared by both
// fixture boards and means a different peripheral on each.

describe('board peripherals as externs', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('a peripheral becomes an extern whose $provides is its C type', () => {
        const externs = board_externs(FIXTURE_BOARD);
        expectOk(externs);

        expect(externs.value.externs.map(extern => `${extern.$symbol}:${extern.$provides}`)).toEqual([
            'bsp_test_spi_cfg:test_spi_config',
            'bsp_test_led:test_gpio_pin',
        ]);
    });

    test('a kind with no bsp_kinds row is skipped, not refused', () => {
        // board.schema leaves `peripherals` open, so an unknown kind is a gap in our table
        // rather than a broken board - refusing would break every board that gains one.
        const externs = board_externs(FIXTURE_BOARD);
        expectOk(externs);
        expect(externs.value.skipped).toEqual([{ kind: 'mystery', symbols: ['bsp_test_mystery'] }]);
    });

    test('the declared values are not read, only the symbol and its type', () => {
        const externs = board_externs(FIXTURE_BOARD);
        expectOk(externs);
        // `identifier: 0` and friends are inputs to the platform's BSP generator.
        expect(Object.keys(externs.value.externs[0])).not.toContain('identifier');
    });

    test('externs are built fresh, never shared', () => {
        const first = board_externs(FIXTURE_BOARD);
        const second = board_externs(FIXTURE_BOARD);
        expectOk(first);
        expectOk(second);
        expect(first.value.externs[0]).not.toBe(second.value.externs[0]);
        expect(first.value.externs[0]).toEqual(second.value.externs[0]);
    });

    test('a board peripheral is not in the global index', () => {
        // Which is the point: two boards declare the same name, so pooling them would
        // collide and mean nothing.
        expect(resolve_entry('bsp_test_spi_cfg').ok).toBe(false);
        expect(load_resolved_ruleset('bsp_test_spi_cfg').ok).toBe(false);
    });

    test('it resolves only for the board that declares it', () => {
        const resolved = load_resolved_ruleset_for_board('bsp_test_spi_cfg', FIXTURE_BOARD);
        expectOk(resolved);
        expect(resolved.value._t).toBe('RulesetExtern');

        // otherboard declares the same symbol, so this one resolves too - to its own.
        const other = find_board_extern('otherboard', 'bsp_test_led');
        expectOk(other);
        expect(other.value).toBeUndefined();
    });

    test('with no board there is nothing to resolve against', () => {
        expectErrorContains(load_resolved_ruleset_for_board('bsp_test_spi_cfg'), 'Unknown ruleset');
    });

    test('a parse failure in the global index is never reported as not-found', () => {
        // The fallback branches on whether the index HAS the symbol, so a broken shared
        // ruleset still says why rather than claiming no module defines it.
        const resolved = load_resolved_ruleset_for_board('no_such_symbol', FIXTURE_BOARD);
        expectErrorContains(resolved, "declares no such peripheral");
    });

    test('bsp_kinds is cross-checked in both directions', () => {
        const problems = check_bsp_kinds();
        expectOk(problems);

        // Every row resolves to a real symbol; the one complaint is the kind the fixture
        // board declares that the table has not heard of.
        expect(problems.value.map(problem => problem.kind)).toEqual(['mystery']);
        expect(problems.value[0].message).toContain('no bsp_kinds row');
    });
});
