/**
 * Platforms, chips and boards, read from the platform modules among the configured roots.
 *
 * This replaces reading no-OS's `CMakePresets.json`. Nothing here needs a file that does
 * not already exist: a platform module declares its own boards and chips, and each board
 * module says which chip it carries, so the whole chain is read-only and asks nothing of
 * the repos that own those files.
 *
 *   <platform>/module.yml      boards: [max32655fthr, ...]   socs: [{name, descriptor}]
 *                             metadata.vendor: maxim
 *   <platform>/boards/<b>/module.yml   metadata.mcu: max32655
 *   <platform>/<soc descriptor>        platform/family/arch/cpu, peripheral instances
 *
 * Boards are read on demand rather than during registry build: they carry no rulesets, and
 * a platform's board modules are large (a full pinout each) while most commands never look
 * at them.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import { MODULE_FILENAME, read_module } from "./module_yml";
import { get_registry, MODULE_TYPE_PLATFORM } from "./registry";
import type { BoardInfo, ModuleInfo, SocInfo } from "./types";

/** Where a platform module keeps its per-board modules. */
const BOARDS_SUBDIR = "boards";

/** Every platform backend among the configured module roots. */
export function list_platform_modules(): Result<ModuleInfo[]> {
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}

	return ok(registry.value.modules.filter(module => module.type === MODULE_TYPE_PLATFORM));
}

/**
 * Every chip supported by any configured platform, with the platform that supports it.
 *
 * A chip is the level a project is actually built for, and it is what a workfile has to
 * name when no board is chosen.
 */
export function list_socs(): Result<{ soc: SocInfo, platform: ModuleInfo }[]> {
	const platforms = list_platform_modules();
	if (!platforms.ok) {
		return platforms;
	}

	const result: { soc: SocInfo, platform: ModuleInfo }[] = [];
	for (const platform of platforms.value) {
		for (const soc of platform.socs ?? []) {
			result.push({ soc, platform });
		}
	}

	return ok(result);
}

/** The platform module supporting a chip, and the chip's own declared entry. */
export function find_soc(soc_name: string): Result<{ soc: SocInfo, platform: ModuleInfo }> {
	const socs = list_socs();
	if (!socs.ok) {
		return socs;
	}

	const found = socs.value.find(entry => entry.soc.name === soc_name);
	if (found === undefined) {
		const known = socs.value.map(entry => entry.soc.name).sort().join(", ");
		return error(`Unknown chip '${soc_name}'. Configured platforms support: ${known}`, soc_name);
	}

	return ok(found);
}

/** The boards one platform module declares, each resolved through its own board module. */
function boards_of(platform: ModuleInfo): Result<BoardInfo[]> {
	const boards: BoardInfo[] = [];

	for (const name of platform.boards ?? []) {
		const board_path = path.join(platform.path, BOARDS_SUBDIR, name);
		if (!fs.existsSync(path.join(board_path, MODULE_FILENAME))) {
			return error(
				`Platform '${platform.name}' declares board '${name}', which has no ${MODULE_FILENAME} at ${board_path}`,
				platform.path
			);
		}

		const module = read_module(board_path);
		if (!module.ok) {
			return module;
		}

		boards.push({
			name: name,
			platform: platform.name,
			soc: module.value.mcu,
			vendor: module.value.vendor ?? platform.vendor,
			description: module.value.description,
			path: board_path,
		});
	}

	return ok(boards);
}

/** Every board any configured platform supports. */
export function list_boards(): Result<BoardInfo[]> {
	const platforms = list_platform_modules();
	if (!platforms.ok) {
		return platforms;
	}

	const boards: BoardInfo[] = [];
	for (const platform of platforms.value) {
		const found = boards_of(platform);
		if (!found.ok) {
			return found;
		}
		boards.push(...found.value);
	}

	return ok(boards);
}

/**
 * One board by name.
 *
 * Board names are unique in practice (they are product names), but two platforms could in
 * principle declare the same one, so an ambiguity is reported rather than resolved by
 * whichever root happened to be configured first.
 */
export function find_board(board_name: string): Result<BoardInfo> {
	const boards = list_boards();
	if (!boards.ok) {
		return boards;
	}

	const matches = boards.value.filter(board => board.name === board_name);
	if (matches.length === 0) {
		const known = boards.value.map(board => board.name).sort().join(", ");
		return error(`Unknown board '${board_name}'. Configured platforms support: ${known}`, board_name);
	}
	if (matches.length > 1) {
		const owners = matches.map(board => board.platform).join(", ");
		return error(`Board '${board_name}' is declared by more than one platform: ${owners}`, board_name);
	}

	return ok(matches[0]);
}

/**
 * The chip a board carries.
 *
 * This is the inference that lets a board be the only thing a user picks: the board module
 * names its chip, and the chip names its platform.
 */
export function soc_for_board(board_name: string): Result<string> {
	const board = find_board(board_name);
	if (!board.ok) {
		return board;
	}

	if (board.value.soc === undefined) {
		return error(`Board '${board_name}' does not declare which chip it carries (metadata.mcu)`, board_name);
	}

	return ok(board.value.soc);
}

/**
 * The one board a project is generated for.
 *
 * Codegen names a single board, so it is settled here rather than left to a target: an
 * explicit choice wins, and otherwise a chip with exactly one board needs no choice at
 * all. More than one is a question only the user can answer, so it is asked rather than
 * guessed.
 */
export function resolve_board(soc_name: string, requested?: string): Result<BoardInfo> {
	if (requested !== undefined) {
		const board = find_board(requested);
		if (!board.ok) {
			return board;
		}
		if (board.value.soc !== undefined && board.value.soc !== soc_name) {
			return error(`Board '${requested}' carries ${board.value.soc}, but this workfile targets ${soc_name}`, requested);
		}
		return board;
	}

	const boards = list_boards();
	if (!boards.ok) {
		return boards;
	}

	const candidates = boards.value.filter(board => board.soc === soc_name);
	if (candidates.length === 0) {
		return error(`No board carries ${soc_name}, so one cannot be chosen for you`, soc_name);
	}
	if (candidates.length > 1) {
		const names = candidates.map(board => board.name).sort().join(", ");
		return error(`More than one board carries ${soc_name}: ${names}. Pick one.`, soc_name);
	}

	return ok(candidates[0]);
}

/**
 * A chip's descriptor: the per-chip file a platform's `socs:` entry points at.
 *
 * Holds what nothing else does — memory sizes, and the peripheral instance lists that bound
 * a controller `identifier`. Returned as parsed YAML rather than a typed shape, because
 * these files are the platform's own and analog-attach reads only parts of them.
 */
export function read_soc_descriptor(soc_name: string): Result<Record<string, unknown>> {
	const found = find_soc(soc_name);
	if (!found.ok) {
		return found;
	}

	const { soc, platform } = found.value;
	if (soc.descriptor === undefined) {
		return error(`Chip '${soc_name}' declares no descriptor file`, soc_name);
	}

	const file = path.join(platform.path, soc.descriptor);
	let contents: string;
	try {
		contents = fs.readFileSync(file, "utf8");
	} catch {
		return error(`Failed to read chip descriptor for '${soc_name}' at ${file}`, file);
	}

	let parsed: unknown;
	try {
		parsed = YAML.parse(contents);
	} catch (parse_error) {
		const reason = parse_error instanceof Error ? parse_error.message : String(parse_error);
		return error(`Failed to parse chip descriptor ${file}: ${reason}`, file);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return error(`Chip descriptor ${file} is not a YAML mapping`, file);
	}

	return ok(parsed as Record<string, unknown>);
}
