import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { set_target_setting } from '../../src/settings/target';
import { get_effective_setting_value, set_setting_value } from '../../src/settings/settings';
import { expectOk, expectError, setup_test_config, teardown_test_config, FIXTURE_BOARD, FIXTURE_SOC } from '../test_utilities';

// The fixture platform carries two chips: testboard is on testsoc, otherboard on othersoc.
const OTHER_BOARD = 'otherboard';
const OTHER_SOC = 'othersoc';

function configured(key: 'board' | 'platform'): string | undefined {
    const value = get_effective_setting_value(key);
    expectOk(value);
    return value.value;
}

describe('set_target_setting', () => {
    beforeEach(() => {
        setup_test_config();
    });

    afterEach(() => {
        teardown_test_config();
    });

    test('a board sets the platform it carries', () => {
        const written = set_target_setting('board', FIXTURE_BOARD);
        expectOk(written);

        expect(configured('board')).toBe(FIXTURE_BOARD);
        expect(configured('platform')).toBe(FIXTURE_SOC);
        expect(written.value.changed).toEqual({ board: FIXTURE_BOARD, platform: FIXTURE_SOC });
    });

    test('a later board replaces the platform an earlier one set', () => {
        expectOk(set_target_setting('board', FIXTURE_BOARD));
        expectOk(set_target_setting('board', OTHER_BOARD));

        expect(configured('board')).toBe(OTHER_BOARD);
        expect(configured('platform')).toBe(OTHER_SOC);
    });

    test('a platform the board does not carry clears the board', () => {
        expectOk(set_target_setting('board', FIXTURE_BOARD));

        const written = set_target_setting('platform', OTHER_SOC);
        expectOk(written);

        expect(configured('platform')).toBe(OTHER_SOC);
        expect(configured('board')).toBeUndefined();
        expect(written.value.changed).toEqual({ platform: OTHER_SOC, board: undefined });
        expect(written.value.reason).toContain(FIXTURE_BOARD);
    });

    test('a platform the board carries keeps the board', () => {
        expectOk(set_target_setting('board', FIXTURE_BOARD));
        expectOk(set_target_setting('platform', FIXTURE_SOC));

        expect(configured('board')).toBe(FIXTURE_BOARD);
        expect(configured('platform')).toBe(FIXTURE_SOC);
    });

    test('an unknown board is refused and nothing is written', () => {
        expectOk(set_target_setting('board', FIXTURE_BOARD));

        expectError(set_target_setting('board', 'no_such_board'));

        expect(configured('board')).toBe(FIXTURE_BOARD);
        expect(configured('platform')).toBe(FIXTURE_SOC);
    });

    test('an unknown platform is refused and nothing is written', () => {
        expectOk(set_target_setting('board', FIXTURE_BOARD));

        expectError(set_target_setting('platform', 'no_such_chip'));

        expect(configured('board')).toBe(FIXTURE_BOARD);
        expect(configured('platform')).toBe(FIXTURE_SOC);
    });

    test('clearing the board leaves the platform', () => {
        expectOk(set_target_setting('board', FIXTURE_BOARD));
        expectOk(set_target_setting('board'));

        expect(configured('board')).toBeUndefined();
        expect(configured('platform')).toBe(FIXTURE_SOC);
    });

    test('clearing the platform leaves the board, which still implies it', () => {
        expectOk(set_target_setting('board', FIXTURE_BOARD));
        expectOk(set_target_setting('platform'));

        expect(configured('board')).toBe(FIXTURE_BOARD);
        expect(configured('platform')).toBeUndefined();
    });

    test('a mismatch written around it is still cleared by the next target write', () => {
        // set_setting_value() itself does not keep the two in step; the next write through
        // set_target_setting() makes them agree again.
        expectOk(set_setting_value('board', FIXTURE_BOARD));
        expectOk(set_setting_value('platform', OTHER_SOC));

        expectOk(set_target_setting('platform', OTHER_SOC));

        expect(configured('board')).toBeUndefined();
        expect(configured('platform')).toBe(OTHER_SOC);
    });
});
