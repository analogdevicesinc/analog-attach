import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { list_targets, resolve_target } from '../../src/settings/target';
import { expectOk, expectError, setup_test_config, teardown_test_config, FIXTURE_BOARD, FIXTURE_SOC } from '../test_utilities';

// The fixture platform carries two chips: testboard is on testsoc, otherboard on othersoc.
const OTHER_SOC = 'othersoc';

describe('resolve_target', () => {
    beforeEach(() => {
        setup_test_config();
    });

    afterEach(() => {
        teardown_test_config();
    });

    test('a board brings the chip it carries', () => {
        const resolved = resolve_target(FIXTURE_BOARD);
        expectOk(resolved);
        expect(resolved.value).toEqual({ platform: FIXTURE_SOC, board: FIXTURE_BOARD });
    });

    test('a chip is a target on its own, with no board', () => {
        const resolved = resolve_target(OTHER_SOC);
        expectOk(resolved);
        expect(resolved.value).toEqual({ platform: OTHER_SOC });
    });

    test('a name that is neither is refused, listing the boards and the chips', () => {
        const resolved = resolve_target('no_such_target');
        expectError(resolved);
        expect(resolved.error.message).toContain(FIXTURE_BOARD);
        expect(resolved.error.message).toContain(OTHER_SOC);
    });

    test('list_targets: the boards, then the chips', () => {
        const targets = list_targets();
        expect(targets).toContain(FIXTURE_BOARD);
        expect(targets.indexOf(FIXTURE_BOARD)).toBeLessThan(targets.indexOf(FIXTURE_SOC));
    });
});
