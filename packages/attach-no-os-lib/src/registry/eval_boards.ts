/**
 * An eval board as a workfile node: `add eval-adxl355-pmdz` says "this board is on my bench".
 *
 * It is synthesized from the eval board's own module.yml - nothing to write - as a struct
 * flagged `$eval_board`: stored like any node, never generated. Its one field, `part`, names
 * the root of the part it carries, and that link is what makes its pinout wire that part.
 * A part no eval board points at is a bare part: its wiring is the user's to state.
 */

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import type { RulesetStruct } from "../ruleset_parser/types";
import { RulesetType } from "../ruleset_parser/types";
import { get_registry, MODULE_TYPE_EVAL_BOARD } from "./registry";
import type { ModuleInfo } from "./types";

/** The eval-board node's field naming the root of the part it carries. */
export const EVAL_BOARD_PART = "part";

/** The configured eval board called `name`, if any. */
export function find_eval_board_module(name: string): ModuleInfo | undefined {
	const registry = get_registry();
	return registry.ok
		? registry.value.modules.find(module => module.type === MODULE_TYPE_EVAL_BOARD && module.name === name)
		: undefined;
}

/** The node an eval board is, or an error when no configured eval board has that name. */
export function eval_board_ruleset(name: string): Result<RulesetStruct> {
	const module = find_eval_board_module(name);
	if (module === undefined) {
		return error(`No configured eval board is called '${name}'`, name);
	}
	return ok({
		_t: "RulesetStruct",
		$type: RulesetType.RT_STRUCT,
		$symbol: module.name,
		$description: module.description ?? `Eval board ${module.name}`,
		$eval_board: true,
		properties: [{
			_t: "IncludeProperty",
			name: EVAL_BOARD_PART,
			description: `The ${module.implements_driver ?? "part"} this board carries`,
			// Any handle: the part's root is capi_accel_sensor, or capi_adc / capi_dac with --as.
			include_type: RulesetType.RT_DESCRIPTOR,
			required: true,
		}],
	});
}

/** Every configured eval board that carries a part, sorted: what `add <eval board>` takes. */
export function list_eval_boards(): string[] {
	const registry = get_registry();
	return registry.ok
		? registry.value.modules
			.filter(module => module.type === MODULE_TYPE_EVAL_BOARD && module.implements_driver !== undefined)
			.map(module => module.name)
			.sort()
		: [];
}
