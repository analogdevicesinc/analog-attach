/**
 * The `target` setting: what a new workfile is for.
 *
 * A board carries one chip, and the chip is the platform a workfile targets, so the board
 * and the platform are one choice. The setting names a board, which brings its chip, or a
 * chip on its own, for a chip with no board of its own.
 */

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import { find_soc, list_boards, list_socs, soc_for_board } from "../registry/platforms";

export const TARGET_SETTING = "target";

/** The platform (chip) a target names, and its board when it names one. */
export interface ResolvedTarget {
	platform: string;
	board?: string;
}

/**
 * What `target` names: a board and the chip it carries, or a chip. A board is looked for
 * first, since that is what most projects target; a name that is neither is refused, with
 * what the configured platforms have.
 */
export function resolve_target(value: string): Result<ResolvedTarget> {
	const boards = list_boards();
	if (boards.ok && boards.value.some(board => board.name === value)) {
		const soc = soc_for_board(value);
		return soc.ok ? ok({ platform: soc.value, board: value }) : soc;
	}
	const soc = find_soc(value);
	if (soc.ok) {
		return ok({ platform: value });
	}
	const known = list_targets();
	if (known.length === 0) {
		return error(`Unknown target '${value}': the configured modules have no boards or chips. Check capi-path and module-paths`, value);
	}
	return error(`Unknown target '${value}'. It can be a board or a chip: ${known.join(", ")}`, value);
}

/** Every name `target` takes: the boards, then the chips. */
export function list_targets(): string[] {
	const boards = list_boards();
	const socs = list_socs();
	return [
		...(boards.ok ? boards.value.map(board => board.name) : []),
		...(socs.ok ? socs.value.map(entry => entry.soc.name) : []),
	];
}
