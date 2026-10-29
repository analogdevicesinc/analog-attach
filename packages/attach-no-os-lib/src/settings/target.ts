/**
 * The `board` and `platform` settings, kept in agreement.
 *
 * A board carries one chip, and the chip is the platform a workfile targets, so the two
 * settings are one choice seen twice. A write of either says what else has to change with
 * it: a board sets the platform it carries, and a platform the current board does not
 * carry clears the board. The caller writes them together (the CLI's settings `check`
 * hook returns them as `also`).
 */

import type { Result } from "../ruleset_parser/result";
import { ok } from "../ruleset_parser/result";
import { find_soc, soc_for_board } from "../registry/platforms";

export type TargetSetting = "board" | "platform";

export function is_target_setting(key: string): key is TargetSetting {
	return key === "board" || key === "platform";
}

/** The board and platform in effect. */
export interface TargetState {
	board?: string;
	platform?: string;
}

/** What a target write changes beside the key written. */
export interface TargetWrite {
	/** The other key, with its new value, or `null` for cleared. */
	also: Partial<Record<TargetSetting, string | null>>;
	/** Why it changed, for the message. */
	reason?: string;
}

/**
 * What writing `key = value` takes with it, given the target in effect. An unknown board
 * or chip is refused, so nothing is written for it.
 */
export function target_writes(key: TargetSetting, value: string, current: TargetState): Result<TargetWrite> {
	if (key === "board") {
		// The platform follows from the board, so a board whose chip cannot be found is
		// refused here rather than left for init to fail on.
		const soc = soc_for_board(value);
		if (!soc.ok) {
			return soc;
		}
		return ok({ also: { platform: soc.value }, reason: `board '${value}' carries ${soc.value}` });
	}

	const soc = find_soc(value);
	if (!soc.ok) {
		return soc;
	}
	// A board that carries another chip goes; one that cannot be resolved is left alone,
	// for init to report as it always has.
	const board = current.board;
	if (board !== undefined) {
		const carried = soc_for_board(board);
		if (carried.ok && carried.value !== value) {
			// eslint-disable-next-line unicorn/no-null
			return ok({ also: { board: null }, reason: `board '${board}' carries ${carried.value}, not ${value}` });
		}
	}
	return ok({ also: {} });
}

/** Why a board and a platform disagree, or undefined when they agree (or either is unset or unknown). */
export function target_mismatch(state: TargetState): string | undefined {
	const { board, platform } = state;
	if (board === undefined || platform === undefined) {
		return undefined;
	}
	const carried = soc_for_board(board);
	return carried.ok && carried.value !== platform ? `Board '${board}' carries ${carried.value}, not ${platform}` : undefined;
}
