import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { target_mismatch, target_writes } from '../../src/settings/target';
import { expectOk, expectError, setup_test_config, teardown_test_config, FIXTURE_BOARD, FIXTURE_SOC } from '../test_utilities';

// The fixture platform carries two chips: testboard is on testsoc, otherboard on othersoc.
const OTHER_BOARD = 'otherboard';
const OTHER_SOC = 'othersoc';

describe('target_writes', () => {
    beforeEach(() => {
        setup_test_config();
    });

    afterEach(() => {
        teardown_test_config();
    });

    test('a board sets the platform it carries', () => {
        const written = target_writes('board', FIXTURE_BOARD, {});
        expectOk(written);
        expect(written.value.also).toEqual({ platform: FIXTURE_SOC });
        expect(written.value.reason).toContain(FIXTURE_SOC);
    });

    test('a later board replaces the platform an earlier one set', () => {
        const written = target_writes('board', OTHER_BOARD, { board: FIXTURE_BOARD, platform: FIXTURE_SOC });
        expectOk(written);
        expect(written.value.also).toEqual({ platform: OTHER_SOC });
    });

    test('a platform the board does not carry clears the board', () => {
        const written = target_writes('platform', OTHER_SOC, { board: FIXTURE_BOARD, platform: FIXTURE_SOC });
        expectOk(written);
        // eslint-disable-next-line unicorn/no-null
        expect(written.value.also).toEqual({ board: null });
        expect(written.value.reason).toContain(FIXTURE_BOARD);
    });

    test('a platform the board carries keeps the board', () => {
        const written = target_writes('platform', FIXTURE_SOC, { board: FIXTURE_BOARD });
        expectOk(written);
        expect(written.value.also).toEqual({});
    });

    test('an unknown board or platform is refused', () => {
        expectError(target_writes('board', 'no_such_board', {}));
        expectError(target_writes('platform', 'no_such_chip', {}));
    });

    test('an unknown board in effect is left for init to report', () => {
        const written = target_writes('platform', OTHER_SOC, { board: 'no_such_board' });
        expectOk(written);
        expect(written.value.also).toEqual({});
    });
});

describe('target_mismatch', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('a board and the platform it carries agree; another platform does not', () => {
        expect(target_mismatch({ board: FIXTURE_BOARD, platform: FIXTURE_SOC })).toBeUndefined();
        expect(target_mismatch({ board: FIXTURE_BOARD })).toBeUndefined();
        expect(target_mismatch({ board: FIXTURE_BOARD, platform: OTHER_SOC })).toBe(`Board '${FIXTURE_BOARD}' carries ${FIXTURE_SOC}, not ${OTHER_SOC}`);
    });
});
