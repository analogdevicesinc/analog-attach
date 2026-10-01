import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
    list_platform_modules,
    list_socs,
    find_soc,
    list_boards,
    find_board,
    soc_for_board,
    resolve_board,
    read_soc_descriptor,
} from '../../src/registry/platforms';
import {
    expectErrorContains,
    expectOk,
    setup_test_config,
    teardown_test_config,
    FIXTURE_BOARD,
    FIXTURE_SOC,
} from '../test_utilities';

// Boards and chips come from the platform module's own declarations - `boards:`, `socs:`,
// and each board module's `metadata.mcu` - so nothing here needs a file that upstream does
// not already maintain. This replaces reading no-OS's CMakePresets.json.

describe('platforms, chips and boards', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('a platform backend is found by its module type', () => {
        const platforms = list_platform_modules();
        expectOk(platforms);
        expect(platforms.value.map(module => module.name)).toEqual(['platform-test']);
        expect(platforms.value[0].vendor).toBe('testvendor');
    });

    test('chips are listed with the platform that supports them', () => {
        const socs = list_socs();
        expectOk(socs);
        expect(socs.value.map(entry => entry.soc.name)).toEqual(['testsoc', 'othersoc', 'boardless']);
        expect(socs.value.every(entry => entry.platform.name === 'platform-test')).toBe(true);
    });

    test('a board names its own chip, which is what lets the board be the only choice', () => {
        const soc = soc_for_board(FIXTURE_BOARD);
        expectOk(soc);
        expect(soc.value).toBe(FIXTURE_SOC);
    });

    test('boards carry the chip and the vendor they inherit', () => {
        const boards = list_boards();
        expectOk(boards);
        expect(boards.value.map(board => `${board.name}:${board.soc}`)).toEqual([
            'testboard:testsoc',
            'otherboard:othersoc',
            'twobusboard:othersoc',
        ]);
        expect(boards.value[0].vendor).toBe('testvendor');
    });

    test('a chip with exactly one board needs no choice made', () => {
        const board = resolve_board(FIXTURE_SOC);
        expectOk(board);
        expect(board.value.name).toBe(FIXTURE_BOARD);
    });

    test('a chip with no board cannot have one chosen for it', () => {
        // Exactly the case the `platform` setting exists for.
        const board = resolve_board('boardless');
        expectErrorContains(board, 'No board carries boardless');
    });

    test('a board that contradicts the chip is reported, not quietly preferred', () => {
        const board = resolve_board(FIXTURE_SOC, 'otherboard');
        expectErrorContains(board, 'carries othersoc');
    });

    test('an unknown board lists what is available', () => {
        const board = find_board('nope');
        expectErrorContains(board, "Unknown board 'nope'");
        expectErrorContains(board, FIXTURE_BOARD);
    });

    test('an unknown chip lists what is available', () => {
        expectErrorContains(find_soc('nope'), "Unknown chip 'nope'");
    });

    test('the chip descriptor carries what nothing else does', () => {
        // Peripheral instance lists are the bound on a controller identifier; they live
        // only here, so reading them is the whole reason the descriptor is followed.
        const descriptor = read_soc_descriptor(FIXTURE_SOC);
        expectOk(descriptor);
        expect(descriptor.value.platform).toBe('platform-test');
        expect(descriptor.value.peripherals).toEqual({ spi: { count: 2, instances: [0, 1] } });
    });

    test('a chip declaring no descriptor file says so', () => {
        expectErrorContains(read_soc_descriptor('boardless'), 'declares no descriptor file');
    });
});
