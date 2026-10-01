/**
 * Board peripherals as referenceable externs.
 *
 * An application does not construct a bus controller config — it references the one its
 * board's BSP already defines:
 *
 *   capi_spi_init(&spi_ctrl, &bsp_spi1_cfg);
 *
 * So each peripheral a board declares becomes a `$type: extern` ruleset: a symbol that can
 * be assigned to a matching field and is never emitted. The board.yml key is the C symbol
 * verbatim, and `bsp_kinds` supplies the only missing piece, the type it has.
 *
 * The declared VALUES (`identifier: 0`, `baudrate: 115200`, `extra: {port: MXC_GPIO2}`) are
 * deliberately not read. They are inputs to the platform's own BSP generator, which emits
 * the parameters.c that defines these symbols; analog-attach only needs to know the symbols
 * exist and what type they have. That is what makes this cheap.
 *
 * These are scoped to ONE board, never pooled. Board peripherals share names on purpose, so
 * app code is portable: `bsp_uart_cfg` is declared by every capi-maxim board and means a
 * different peripheral on each. Only one board is ever linked, so only the selected board's
 * peripherals exist — pooling them would both collide and be meaningless.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import type { RulesetExtern } from "../ruleset_parser/types";
import { RulesetType } from "../ruleset_parser/types";
import { find_board, list_boards } from "./platforms";
import { get_registry } from "./registry";

/** The peripheral catalog a platform board declares, beside its `module.yml`. */
const BOARD_FILENAME = "board.yml";

/** A board.yml grouping key with no `bsp_kinds` row, and the symbols lost with it. */
export interface SkippedKind {
	kind: string,
	symbols: string[],
}

export interface BoardExterns {
	externs: RulesetExtern[],
	/**
	 * Kinds that were skipped for want of a `bsp_kinds` row. `peripherals` is an open map
	 * in board.schema, so an unknown kind is a gap in our table rather than a broken board,
	 * and refusing the whole board over one would make a new peripheral kind upstream break
	 * every board that has one.
	 */
	skipped: SkippedKind[],
}

/** Read one board's peripheral catalog: kind -> symbol -> (ignored) entry. */
function read_peripherals(board_path: string): Result<Record<string, string[]>> {
	const file = path.join(board_path, BOARD_FILENAME);
	if (!fs.existsSync(file)) {
		// A board with no catalog contributes nothing. That is a board whose BSP is entirely
		// hand-written, not an error.
		return ok({});
	}

	let contents: string;
	try {
		contents = fs.readFileSync(file, "utf8");
	} catch {
		return error(`Failed to read ${file}`, file);
	}

	let parsed: unknown;
	try {
		parsed = YAML.parse(contents);
	} catch (parse_error) {
		const reason = parse_error instanceof Error ? parse_error.message : String(parse_error);
		return error(`Failed to parse ${file}: ${reason}`, file);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return error(`${file} is not a YAML mapping`, file);
	}

	const peripherals = (parsed as Record<string, unknown>).peripherals;
	if (peripherals === undefined) {
		return ok({});
	}
	if (typeof peripherals !== "object" || peripherals === null || Array.isArray(peripherals)) {
		return error(`${file}: 'peripherals' must be a mapping of kind to symbols`, file);
	}

	const by_kind: Record<string, string[]> = {};
	for (const [kind, entries] of Object.entries(peripherals as Record<string, unknown>)) {
		if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
			return error(`${file}: peripheral kind '${kind}' must be a mapping of symbol to entry`, file);
		}
		by_kind[kind] = Object.keys(entries);
	}

	return ok(by_kind);
}

/**
 * The externs one board contributes.
 *
 * Built fresh on every call. An extern has no properties so there is nothing a caller could
 * write onto it today, but `add_symbol` stores a ruleset by reference and the rest of the
 * loader is careful to hand out fresh objects, so this does too rather than rely on externs
 * staying property-free.
 */
export function board_externs(board_name: string): Result<BoardExterns> {
	const board = find_board(board_name);
	if (!board.ok) {
		return board;
	}

	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}

	const peripherals = read_peripherals(board.value.path);
	if (!peripherals.ok) {
		return peripherals;
	}

	const externs: RulesetExtern[] = [];
	const skipped: SkippedKind[] = [];

	for (const [kind, symbols] of Object.entries(peripherals.value)) {
		const provides = registry.value.bsp_kinds.get(kind);
		if (provides === undefined) {
			skipped.push({ kind, symbols });
			continue;
		}

		for (const symbol of symbols) {
			externs.push({
				_t: "RulesetExtern",
				$type: RulesetType.RT_EXTERN,
				$symbol: symbol,
				$description: `${kind} provided by board ${board_name}`,
				// What an `include` must name to accept this node. A board peripheral is
				// referenced wherever its type is expected, which is how bsp_spi1_cfg lands
				// on a controller's $init_param.
				$provides: provides,
				// No $header: every one of a board's peripherals is declared by the same
				// board BSP header, so that is one include a target emits once rather than a
				// fact repeated on each symbol.
				$array: false,
			});
		}
	}

	return ok({ externs, skipped });
}

/** One board peripheral by symbol, or undefined when the board declares no such symbol. */
export function find_board_extern(board_name: string, symbol: string): Result<RulesetExtern | undefined> {
	const found = board_externs(board_name);
	if (!found.ok) {
		return found;
	}

	return ok(found.value.externs.find(extern => extern.$symbol === symbol));
}

/** A `bsp_kinds` row naming a type no module defines, or a board kind with no row. */
export interface BspKindProblem {
	kind: string,
	message: string,
}

/**
 * Cross-check `bsp_kinds` against what is actually on disk, in both directions.
 *
 * A central table's one weakness is drift — a row naming a struct that has since been
 * renamed, or a board gaining a kind the table has not heard of. Neither shows up as a
 * failure at the point of the mistake, so they are checked explicitly: every row must name
 * a known `$symbol`, and every kind any configured board declares should have a row.
 */
export function check_bsp_kinds(): Result<BspKindProblem[]> {
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}

	const problems: BspKindProblem[] = [];

	for (const [kind, provides] of registry.value.bsp_kinds) {
		if (!registry.value.symbols.has(provides)) {
			problems.push({
				kind,
				message: `bsp_kinds maps '${kind}' to '${provides}', which no configured module defines`,
			});
		}
	}

	const boards = list_board_kinds();
	if (!boards.ok) {
		return boards;
	}

	for (const [kind, board_names] of Object.entries(boards.value)) {
		if (!registry.value.bsp_kinds.has(kind)) {
			problems.push({
				kind,
				message: `board peripheral kind '${kind}' has no bsp_kinds row, so its symbols are skipped (declared by: ${board_names.join(", ")})`,
			});
		}
	}

	return ok(problems);
}

/** Every peripheral kind any configured board declares, with the boards declaring it. */
function list_board_kinds(): Result<Record<string, string[]>> {
	const boards = list_boards();
	if (!boards.ok) {
		return boards;
	}

	const kinds: Record<string, string[]> = {};
	for (const board of boards.value) {
		const peripherals = read_peripherals(board.path);
		if (!peripherals.ok) {
			return peripherals;
		}
		for (const kind of Object.keys(peripherals.value)) {
			(kinds[kind] ??= []).push(board.name);
		}
	}

	return ok(kinds);
}
