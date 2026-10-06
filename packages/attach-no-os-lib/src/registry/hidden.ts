/**
 * Hidden nodes: the ones a workfile references but never stores.
 *
 * A node is hidden when nothing about it is a choice - it only ever appears on the right
 * of an assignment:
 *
 *   an extern                          a symbol the board BSP or a driver already defines
 *                                      (bsp_spi1_cfg, adxl355_capi_accel_ops)
 *   a descriptor wrapping a hidden one the handle for that resource
 *                                      (a capi_spi_controller whose $init_param is bsp_spi1_cfg)
 *
 * Stored nodes reference hidden ones by name, and the name alone says what to rebuild, so
 * nothing about a hidden node is ever saved:
 *
 *   an extern       its own symbol          bsp_spi1_cfg
 *   a wrapper       <extern>_handle         bsp_spi1_cfg_handle
 *
 * One name per resource also makes a resource naturally shared: two devices on one bus both
 * reference bsp_spi1_cfg_handle, and that is one controller.
 *
 * This module only says what COULD exist. Putting a hidden node into a workfile is
 * bootstrap/hidden.ts's job.
 */

import type { Result } from "../ruleset_parser/result";
import { ok } from "../ruleset_parser/result";
import { RulesetType } from "../ruleset_parser/types";
import { load_resolved_ruleset } from "../resolver/resolver";
import { board_externs } from "./bsp";
import { all_symbols, resolve_entry } from "./registry";

/** Every extern the configured modules and one board offer, by the type each provides. */
export interface ExternIndex {
	by_type: Map<string, string[]>,
	/** The board's own peripherals, which resolve against the board rather than the index. */
	board: Set<string>,
}

export function build_extern_index(board: string | undefined): Result<ExternIndex> {
	const by_type = new Map<string, string[]>();
	const board_symbols = new Set<string>();
	const add = (type_: string, symbol: string) => by_type.set(type_, [...by_type.get(type_) ?? [], symbol]);

	const entries = all_symbols();
	if (!entries.ok) {
		return entries;
	}
	for (const entry of entries.value) {
		if (entry.$type !== RulesetType.RT_EXTERN) {
			continue;
		}
		const extern = load_resolved_ruleset(entry.$symbol);
		if (extern.ok && extern.value._t === "RulesetExtern") {
			add(extern.value.$provides, entry.$symbol);
		}
	}

	if (board !== undefined) {
		const externs = board_externs(board);
		if (!externs.ok) {
			return externs;
		}
		for (const extern of externs.value.externs) {
			add(extern.$provides, extern.$symbol);
			board_symbols.add(extern.$symbol);
		}
	}

	return ok({ by_type, board: board_symbols });
}

/** A hidden node that could fill a reference, before anything is created. */
export type HiddenCandidate =
	| { kind: "extern", name: string, symbol: string }
	| { kind: "wrapper", name: string, symbol: string, wraps: string };

/** The name a descriptor wrapping `extern` is known by. */
export function wrapper_name(extern: string): string {
	return `${extern}_handle`;
}

/**
 * Every hidden node that could fill a reference to `type_`.
 *
 * An extern providing the type directly, and - when the type is a descriptor - a handle
 * wrapping each extern that provides what the descriptor is initialized from.
 */
export function hidden_candidates(type_: string, externs: ExternIndex): HiddenCandidate[] {
	const candidates: HiddenCandidate[] = (externs.by_type.get(type_) ?? [])
		.map(symbol => ({ kind: "extern", name: symbol, symbol }));

	const entry = resolve_entry(type_);
	if (!entry.ok || entry.value.$type !== RulesetType.RT_DESCRIPTOR) {
		return candidates;
	}

	const descriptor = load_resolved_ruleset(type_);
	if (!descriptor.ok || descriptor.value._t !== "RulesetDescriptor") {
		return candidates;
	}

	const config_type = descriptor.value.properties[0].include;
	if (config_type === undefined) {
		return candidates;
	}

	for (const extern of externs.by_type.get(config_type) ?? []) {
		candidates.push({ kind: "wrapper", name: wrapper_name(extern), symbol: type_, wraps: extern });
	}

	return candidates;
}
