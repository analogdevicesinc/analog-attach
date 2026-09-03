import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	boards_for_platform,
	find_board,
	platform_for_board,
	resolve_board,
	resolve_platform_from_board,
	scan_boards,
} from '../../src/workfile_handler/board_scanner';
import type { Board, PlatformSpecs } from '../../src/workfile_handler/types';
import { expectOk, expectError, expectErrorContains } from '../test_utilities';

/*
 * A miniature no-OS presets tree, one board per interesting case, written to a temp
 * directory. Built here rather than read from a checkout for the reason the whole
 * derivation exists: upstream board names and TARGETs change, and a test that reads
 * them cannot pin the behaviour it is checking.
 */
const ROOT_PRESETS = {
	version: 6,
	include: ['board_configs/maxim/CMakePresets.json', 'board_configs/stm32/CMakePresets.json'],
	configurePresets: [
		{ name: 'default', generator: 'Ninja' },
	],
};

const MAXIM_PRESETS = {
	version: 6,
	configurePresets: [
		{ name: 'maxim-base', hidden: true, generator: 'Ninja' },
		{
			name: 'ad-apard32690-sl',
			cacheVariables: { BOARD: 'ad-apard32690-sl', PLATFORM: 'maxim', TARGET: 'max32690', TARGET_NUM: '32690' },
		},
		{ name: 'ad-swiot1l-sl', cacheVariables: { BOARD: 'ad-swiot1l-sl', PLATFORM: 'maxim', TARGET: 'max32650' } },
		{ name: 'max32650fthr', cacheVariables: { BOARD: 'max32650fthr', PLATFORM: 'maxim', TARGET: 'max32650' } },
		/* Real upstream case: a maxim board whose chip the schemas do not describe. */
		{ name: 'max32670evkit', cacheVariables: { BOARD: 'max32670evkit', PLATFORM: 'maxim', TARGET: 'max32670' } },
	],
};

const STM32_PRESETS = {
	version: 6,
	configurePresets: [
		/* stm32 is modelled per vendor, so neither TARGET names a schema directory. */
		{ name: 'nucleo-f767zi', cacheVariables: { BOARD: 'nucleo-f767zi', PLATFORM: 'stm32', TARGET: 'stm32f767' } },
		{ name: 'nucleo-h563zi', cacheVariables: { BOARD: 'nucleo-h563zi', PLATFORM: 'stm32', TARGET: 'stm32h563' } },
		/* xilinx presets set no TARGET at all; modelled here on the stm32 file. */
		{ name: 'zed', cacheVariables: { BOARD: 'zed', PLATFORM: 'xilinx' } },
	],
};

/*
 * The schema platforms the boards above resolve against: three maxim chips (per-chip
 * modelling) plus two vendors (per-vendor modelling). There is deliberately no "maxim"
 * key - no `schemas/platforms/maxim/platform.yaml` exists upstream either, and that
 * absence is what stops the vendor fallback from swallowing every maxim board.
 */
const SPECS: PlatformSpecs = Object.fromEntries(
	['max32690', 'max32650', 'max32662', 'stm32', 'xilinx'].map(name => [
		name,
		{ name, vendor: name.startsWith('max') ? 'maxim' : name, ops: [], structs: [] },
	]),
);

let noos_path: string;

beforeAll(() => {
	noos_path = fs.mkdtempSync(path.join(os.tmpdir(), 'board-scanner-'));
	fs.mkdirSync(path.join(noos_path, 'board_configs/maxim'), { recursive: true });
	fs.mkdirSync(path.join(noos_path, 'board_configs/stm32'), { recursive: true });
	fs.writeFileSync(path.join(noos_path, 'CMakePresets.json'), JSON.stringify(ROOT_PRESETS));
	fs.writeFileSync(path.join(noos_path, 'board_configs/maxim/CMakePresets.json'), JSON.stringify(MAXIM_PRESETS));
	fs.writeFileSync(path.join(noos_path, 'board_configs/stm32/CMakePresets.json'), JSON.stringify(STM32_PRESETS));
});

afterAll(() => {
	fs.rmSync(noos_path, { recursive: true, force: true });
});

function board(name: string): Board {
	const found = find_board(noos_path, name);
	expectOk(found);
	return found.value;
}

describe('board_scanner', () => {
	describe('scan_boards', () => {
		test('reads every board the included presets declare, dropping hidden bases', () => {
			const result = scan_boards(noos_path);
			expectOk(result);

			expect(result.value.map(b => b.name)).toEqual([
				'ad-apard32690-sl',
				'ad-swiot1l-sl',
				'max32650fthr',
				'max32670evkit',
				'nucleo-f767zi',
				'nucleo-h563zi',
				'zed',
			]);
		});

		test('rejects a checkout with no presets file', () => {
			const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'board-scanner-empty-'));
			expectErrorContains(scan_boards(empty), 'predates the CMake build system');
			fs.rmSync(empty, { recursive: true, force: true });
		});
	});

	describe('platform_for_board', () => {
		test('prefers the chip when the schemas model that platform per chip', () => {
			expect(platform_for_board(board('ad-apard32690-sl'), SPECS)).toBe('max32690');
		});

		test('falls back to the vendor when the schemas model it per vendor', () => {
			expect(platform_for_board(board('nucleo-f767zi'), SPECS)).toBe('stm32');
		});

		test('resolves a board that declares no chip at all', () => {
			expect(platform_for_board(board('zed'), SPECS)).toBe('xilinx');
		});

		test('resolves to nothing when neither chip nor vendor has schemas', () => {
			expect(platform_for_board(board('max32670evkit'), SPECS)).toBeUndefined();
		});
	});

	describe('boards_for_platform', () => {
		test('finds the boards of a per-vendor platform', () => {
			const result = boards_for_platform(noos_path, 'stm32', SPECS);
			expectOk(result);
			expect(result.value.map(b => b.name)).toEqual(['nucleo-f767zi', 'nucleo-h563zi']);
		});

		test('finds the boards of a per-chip platform without catching its siblings', () => {
			const result = boards_for_platform(noos_path, 'max32690', SPECS);
			expectOk(result);
			expect(result.value.map(b => b.name)).toEqual(['ad-apard32690-sl']);
		});

		test('returns nothing for a platform with no boards', () => {
			const result = boards_for_platform(noos_path, 'max32662', SPECS);
			expectOk(result);
			expect(result.value).toEqual([]);
		});
	});

	describe('resolve_board', () => {
		test('resolves a platform with exactly one board', () => {
			const result = resolve_board(noos_path, 'max32690', SPECS);
			expectOk(result);
			expect(result.value.name).toBe('ad-apard32690-sl');
		});

		test('refuses to guess between two boards of the same platform', () => {
			const result = resolve_board(noos_path, 'max32650', SPECS);
			expectError(result);
			expect(result.error.message).toContain('ad-swiot1l-sl');
			expect(result.error.message).toContain('max32650fthr');
		});

		test('errors for a platform with no boards', () => {
			expectErrorContains(resolve_board(noos_path, 'max32662', SPECS), 'No no-OS board belongs to platform');
		});

		test('accepts an explicit board of a per-vendor platform', () => {
			const result = resolve_board(noos_path, 'stm32', SPECS, 'nucleo-h563zi');
			expectOk(result);
			expect(result.value.name).toBe('nucleo-h563zi');
		});

		test('rejects an explicit board from another platform', () => {
			const result = resolve_board(noos_path, 'max32690', SPECS, 'nucleo-f767zi');
			expectError(result);
			expect(result.error.message).toContain('belongs to platform stm32');
		});

		test('rejects an explicit board with no schemas', () => {
			expectErrorContains(
				resolve_board(noos_path, 'max32690', SPECS, 'max32670evkit'),
				'has no schemas under schemas/platforms/',
			);
		});

		test('rejects an unknown board name', () => {
			expectErrorContains(resolve_board(noos_path, 'max32690', SPECS, 'nope'), "Unknown board 'nope'");
		});
	});

	describe('resolve_platform_from_board', () => {
		test('derives a per-chip platform', () => {
			const result = resolve_platform_from_board(noos_path, 'ad-swiot1l-sl', SPECS);
			expectOk(result);
			expect(result.value.platform).toBe('max32650');
			expect(result.value.board.name).toBe('ad-swiot1l-sl');
		});

		test('derives a per-vendor platform', () => {
			const result = resolve_platform_from_board(noos_path, 'zed', SPECS);
			expectOk(result);
			expect(result.value.platform).toBe('xilinx');
		});

		test('names the boards that do work when a board has no schemas', () => {
			const result = resolve_platform_from_board(noos_path, 'max32670evkit', SPECS);
			expectError(result);
			expect(result.error.message).toContain('targets max32670');
			expect(result.error.message).toContain('ad-apard32690-sl');
			expect(result.error.message).not.toContain('max32670evkit,');
		});
	});
});
