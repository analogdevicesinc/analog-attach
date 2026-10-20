/**
 * The `board` and `platform` settings, kept in agreement.
 *
 * A board carries one chip, and the chip is the platform a workfile targets, so the two
 * settings are one choice seen twice. Writing either through here keeps them from naming
 * different chips: a board sets the platform it carries, and a platform the configured board
 * does not carry clears the board. Both land in the same config file the write targets,
 * and a mismatch that file cannot fix - a board in the global config while the project's
 * local one is written - is refused instead of left in place.
 */

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import { find_soc, soc_for_board } from "../registry/platforms";
import { config_layers, set_setting_value } from "./settings";
import type { SetSettingOptions } from "./settings";

export type TargetSetting = "board" | "platform";

export function is_target_setting(key: string): key is TargetSetting {
	return key === "board" || key === "platform";
}

/** What a target write did, so the caller can say so. */
export interface TargetWrite {
	/** Every key written, with its new value, or undefined for cleared. */
	changed: Partial<Record<TargetSetting, string | undefined>>,
	/** Why a key other than the one asked for changed, for the message. */
	reason?: string,
}

/**
 * Write `board` or `platform` (or clear it, with value undefined), and the other one with
 * it where they would otherwise disagree. Nothing is written when the result would still
 * disagree.
 */
export function set_target_setting(key: TargetSetting, value?: string, options: SetSettingOptions = {}): Result<TargetWrite> {
	const layers = config_layers(options);
	if (!layers.ok) {
		return layers;
	}
	const { target, beneath_path, beneath } = layers.value;
	const next: Record<string, string | undefined> = { ...layers.value.values };
	const changed: TargetWrite["changed"] = { [key]: value };
	let reason: string | undefined;

	if (key === "board" && value !== undefined) {
		// The platform follows from the board, so a board whose chip cannot be found is
		// refused here rather than left for create-workfile to fail on.
		const soc = soc_for_board(value);
		if (!soc.ok) {
			return soc;
		}
		next.board = value;
		next.platform = soc.value;
		changed.platform = soc.value;
		reason = `board '${value}' carries ${soc.value}`;
	} else if (key === "platform" && value !== undefined) {
		const soc = find_soc(value);
		if (!soc.ok) {
			return soc;
		}
		next.platform = value;

		// A board in this same file that carries another chip goes; one that cannot be
		// resolved is left alone, for create-workfile to report as it always has.
		const board = next.board;
		if (board !== undefined) {
			const carried = soc_for_board(board);
			if (carried.ok && carried.value !== value) {
				delete next.board;
				changed.board = undefined;
				reason = `board '${board}' carries ${carried.value}, not ${value}`;
			}
		}
	} else {
		delete next[key];
	}

	// What the write leaves in effect, the target over the file beneath it.
	const board = next.board ?? beneath.board;
	const platform = next.platform ?? beneath.platform;
	if (board !== undefined && platform !== undefined) {
		const carried = soc_for_board(board);
		if (carried.ok && carried.value !== platform) {
			// Only the file beneath can be the cause: within the target this write already
			// made the two agree. Name the setting that lives there.
			const stuck = next.board === undefined ? `board '${board}'` : `platform '${platform}'`;
			return error(
				`Board '${board}' carries ${carried.value}, not ${platform}, and ${stuck} is set in ` +
				`${beneath_path ?? target}, which this write does not change. Clear it there, or ` +
				"write the setting to that file instead."
			);
		}
	}

	for (const [name, written] of Object.entries(changed) as [TargetSetting, string | undefined][]) {
		const result = set_setting_value(name, written, options);
		if (!result.ok) {
			return result;
		}
	}

	return ok(reason === undefined ? { changed } : { changed, reason });
}
