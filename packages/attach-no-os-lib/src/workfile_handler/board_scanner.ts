import * as fs from "node:fs";
import path from "node:path";
import type { Result } from "../ruleset_parser/result";
import { ok, error } from "../ruleset_parser/result";
import type { Board, PlatformSpecs } from "./types";

const PRESETS_FILENAME = "CMakePresets.json";

/*
 * Boards are the build unit; chips stay the schema unit. no-OS's CMake presets are
 * the only authoritative list of buildable boards, so they are read rather than
 * mirrored here - a hardcoded board list would go stale the first time upstream
 * adds one.
 *
 * Mind the vocabulary clash between the two systems:
 *
 *   no-OS preset    schemas             example
 *   PLATFORM        vendor directory    maxim
 *   TARGET          platform directory  max32690
 *   BOARD           (no equivalent)     ad-apard32690-sl
 *
 * The mapping is not uniform: some platforms are modelled per chip and some per
 * vendor, so which of the two fields names a schema directory depends on the board.
 * `platform_for_board` below is the single place that decides, and nothing in the
 * schema tree describes a board.
 */

type PresetJson = {
	include?: unknown,
	configurePresets?: unknown,
};

function read_presets_file(file: string): Result<PresetJson> {
	let contents: string;
	try {
		contents = fs.readFileSync(file, "utf8");
	} catch {
		return error(`Failed to read ${file}`, file);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch (parse_error) {
		const reason = parse_error instanceof Error ? parse_error.message : String(parse_error);
		return error(`Failed to parse ${file}: ${reason}`, file);
	}

	if (typeof parsed !== "object" || parsed === null) {
		return error(`Expected a JSON object in ${file}`, file);
	}

	return ok(parsed as PresetJson);
}

function as_string(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/*
 * A preset carries its board identity in `cacheVariables`. Presets marked `hidden`
 * are the per-vendor bases every board inherits (`maxim-base`) and are not
 * selectable, so they are dropped. The bases only set `generator`, never
 * cacheVariables, which is why inheritance does not have to be resolved to read a
 * board out of a preset.
 */
function parse_preset(preset: unknown): Board | undefined {
	if (typeof preset !== "object" || preset === null) {
		return undefined;
	}

	const object = preset as Record<string, unknown>;
	if (object.hidden === true) {
		return undefined;
	}

	const name = as_string(object.name);
	if (name === undefined) {
		return undefined;
	}

	const cache = typeof object.cacheVariables === "object" && object.cacheVariables !== null
		? object.cacheVariables as Record<string, unknown>
		: undefined;

	const board = as_string(cache?.BOARD);
	const vendor = as_string(cache?.PLATFORM);
	if (board === undefined || vendor === undefined) {
		// The root "default" preset, which selects a generator and nothing else.
		return undefined;
	}

	return {
		name: name,
		board: board,
		vendor: vendor,
		chip: as_string(cache?.TARGET),
		target_num: as_string(cache?.TARGET_NUM),
		board_config_file: as_string(cache?.BOARD_CONFIG_FILE),
		description: as_string(object.description),
	};
}

/**
 * Enumerate every board no-OS can build, by following the root CMakePresets.json
 * into the per-vendor board_configs presets it includes.
 */
export function scan_boards(noos_path: string): Result<Board[]> {
	const root_presets = path.join(noos_path, PRESETS_FILENAME);
	if (!fs.existsSync(root_presets)) {
		return error(`Missing ${PRESETS_FILENAME} in: ${noos_path}. This no-OS checkout predates the CMake build system.`, PRESETS_FILENAME);
	}

	const root = read_presets_file(root_presets);
	if (!root.ok) {
		return root;
	}

	const files = [root_presets];
	if (Array.isArray(root.value.include)) {
		for (const entry of root.value.include) {
			const relative = as_string(entry);
			if (relative === undefined) {
				continue;
			}
			const included = path.join(noos_path, relative);
			if (fs.existsSync(included)) {
				files.push(included);
			} else {
				console.warn(`[board_scanner] ${PRESETS_FILENAME} includes a missing file: ${relative}`);
			}
		}
	}

	const boards: Board[] = [];
	const seen = new Set<string>();

	for (const file of files) {
		const presets = read_presets_file(file);
		if (!presets.ok) {
			console.warn(`[board_scanner] ${presets.error.message}`);
			continue;
		}

		if (!Array.isArray(presets.value.configurePresets)) {
			continue;
		}

		for (const entry of presets.value.configurePresets) {
			const parsed = parse_preset(entry);
			if (parsed === undefined || seen.has(parsed.name)) {
				continue;
			}
			seen.add(parsed.name);
			boards.push(parsed);
		}
	}

	boards.sort((a, b) => a.name.localeCompare(b.name));
	return ok(boards);
}

/**
 * Look up one board by its preset name.
 */
export function find_board(noos_path: string, name: string): Result<Board> {
	const boards = scan_boards(noos_path);
	if (!boards.ok) {
		return boards;
	}

	const found = boards.value.find(b => b.name === name);
	if (found === undefined) {
		const available = boards.value.map(b => b.name).join(", ");
		return error(`Unknown board '${name}'. Available: ${available}`, "board");
	}

	return ok(found);
}

/**
 * The schema platform a board belongs to, or undefined when the schema tree does not
 * describe it.
 *
 * This is the only place the PLATFORM/TARGET granularity mismatch is dealt with, and
 * everything else about board resolution is derived from it. `maxim` is modelled per
 * chip (`schemas/platforms/maxim/max32690/`), while `stm32`, `pico`, `xilinx`, `mbed`
 * and `linux` are modelled per vendor (`schemas/platforms/stm32/`) - so the board's
 * TARGET is tried first and its PLATFORM second, and whichever names a real schema
 * directory wins.
 *
 * The vendor fallback cannot swallow a maxim board by mistake: there is no
 * `schemas/platforms/maxim/platform.yaml`, so `specs` has no "maxim" key. Four boards
 * legitimately resolve to nothing (max32666fthr, max32670evkit, max78000fthr,
 * eval-adicup3029): no schemas exist for their chips, so no project can be generated
 * for them at all.
 */
export function platform_for_board(board: Board, specs: PlatformSpecs): string | undefined {
	if (board.chip !== undefined && specs[board.chip] !== undefined) {
		return board.chip;
	}
	if (specs[board.vendor] !== undefined) {
		return board.vendor;
	}
	return undefined;
}

/**
 * Every board that belongs to one schema platform.
 *
 * Matching through `platform_for_board` rather than on `board.chip` is what makes the
 * vendor-granularity platforms reachable: all eight stm32 presets carry a distinct
 * TARGET (stm32f767, stm32h563, ...) and none of those is a schema directory, so a
 * chip comparison finds nothing for them.
 */
export function boards_for_platform(noos_path: string, platform: string, specs: PlatformSpecs): Result<Board[]> {
	const boards = scan_boards(noos_path);
	if (!boards.ok) {
		return boards;
	}

	return ok(boards.value.filter(b => platform_for_board(b, specs) === platform));
}

/**
 * Settle on the one board a project builds for, starting from the platform.
 *
 * Codegen needs a concrete board (`project.conf` names its defconfig, and the build
 * drives `cmake --preset <board>`), but a workfile may carry only a platform. So the
 * board is resolved here, once, from the explicit choice if there is one and from the
 * platform otherwise. An ambiguous platform is an error rather than a silent
 * first-match: on max32650 the choice between `ad-swiot1l-sl` and `max32650fthr`
 * changes the pin mapping, and guessing it would produce a project that builds and
 * does not work.
 */
export function resolve_board(
	noos_path: string,
	platform: string,
	specs: PlatformSpecs,
	explicit?: string,
): Result<Board> {
	if (explicit !== undefined) {
		const found = find_board(noos_path, explicit);
		if (!found.ok) {
			return found;
		}

		// A board from a different platform than the workfile was built against would
		// resolve platform ops from one chip and compile for another.
		const derived = platform_for_board(found.value, specs);
		if (derived === undefined) {
			return unsupported_board_error(noos_path, found.value, specs);
		}
		if (derived !== platform) {
			return error(
				`Board '${explicit}' belongs to platform ${derived}, but the workfile platform is ${platform}`,
				"board",
			);
		}

		return ok(found.value);
	}

	const candidates = boards_for_platform(noos_path, platform, specs);
	if (!candidates.ok) {
		return candidates;
	}

	if (candidates.value.length === 0) {
		return error(
			`No no-OS board belongs to platform ${platform}. It can only be built with a board named explicitly.`,
			"board",
		);
	}

	if (candidates.value.length > 1) {
		const names = candidates.value.map(b => b.name).join(", ");
		return error(`Several boards belong to ${platform}; pick one: ${names}`, "board");
	}

	return ok(candidates.value[0]);
}

/** A board and the schema platform it resolved to. */
export type ResolvedBoard = { board: Board, platform: string };

/**
 * Settle on a board *and* its platform, starting from the board.
 *
 * This is the board-first entry point: the board is what a user picks off a bench, and
 * the platform follows from it, so nothing has to know the PLATFORM/TARGET mismatch to
 * create a workfile.
 */
export function resolve_platform_from_board(
	noos_path: string,
	board_name: string,
	specs: PlatformSpecs,
): Result<ResolvedBoard> {
	const found = find_board(noos_path, board_name);
	if (!found.ok) {
		return found;
	}

	const platform = platform_for_board(found.value, specs);
	if (platform === undefined) {
		return unsupported_board_error(noos_path, found.value, specs);
	}

	return ok({ board: found.value, platform: platform });
}

/*
 * The one error worth spelling out, because the fix is not in this repo: the board is
 * real and buildable by no-OS itself, and only the schemas are missing. Listing the
 * boards that do work turns a dead end into a choice.
 */
function unsupported_board_error(noos_path: string, board: Board, specs: PlatformSpecs): Result<never> {
	const target = board.chip ?? board.vendor;
	const boards = scan_boards(noos_path);
	const usable = boards.ok
		? boards.value.filter(b => platform_for_board(b, specs) !== undefined).map(b => b.name).join(", ")
		: "(none found)";

	return error(
		`Board '${board.name}' targets ${target}, which has no schemas under schemas/platforms/. `
		+ `Boards with schemas: ${usable}`,
		"board",
	);
}
