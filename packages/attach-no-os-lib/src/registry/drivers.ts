/**
 * Finding the driver behind a CAPI interface.
 *
 * A generic node is configured with two things it cannot name itself: the driver's own
 * init_param, and the driver's ops table. `capi_accel_sensor_init_config` says only which
 * interface it is for —
 *
 *   extra: {type: driver_init_param, interface: accel_sensor}
 *   ops:   {type: driver_ops,        interface: accel_sensor}
 *
 * — and the candidates are whatever a configured driver module declares it provides. That
 * edge is `provides.interfaces` in each driver's module.yml, so the answer comes from
 * declared data rather than from matching `adxl355_*` against a naming convention. A
 * second driver for the same interface simply makes two candidates, which is a choice for
 * the user and not an ambiguity to resolve here.
 */

import type { Result } from "../ruleset_parser/result";
import { ok } from "../ruleset_parser/result";
import { RulesetType } from "../ruleset_parser/types";
import { get_registry } from "./registry";
import type { ModuleInfo, RulesetEntry } from "./types";

/** Every configured module declaring that it implements `interface_`. */
export function modules_providing(interface_: string): Result<ModuleInfo[]> {
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}

	return ok(registry.value.modules.filter(
		module => module.provides_interfaces?.includes(interface_) === true
	));
}

/** Rulesets of one kind, shipped by the modules implementing `interface_`. */
/** The `rulesets:` group a driver lists its IIO device under. */
export const IIO_GROUP = "iio";

function candidates_of(interface_: string, type_: RulesetType): Result<RulesetEntry[]> {
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}

	const providers = modules_providing(interface_);
	if (!providers.ok) {
		return providers;
	}

	// Compared by module path rather than by name: a name is only unique per repo, and the
	// path is what the registry keyed the module on.
	const paths = new Set(providers.value.map(module => module.path));

	// A driver's `iio` group is its IIO side - the IIO device and what only it uses - so
	// none of it is what a generic interface's init_param or ops field takes.
	return ok([...registry.value.symbols.values()].filter(
		entry => entry.$type === type_ && paths.has(entry.module.path) && entry.group !== IIO_GROUP
	));
}

/**
 * Ops tables a driver for this interface offers.
 *
 * An ops table is a symbol the driver already compiles, so it is an extern: referenced,
 * never emitted.
 */
export function driver_ops_candidates(interface_: string): Result<RulesetEntry[]> {
	return candidates_of(interface_, RulesetType.RT_EXTERN);
}

/**
 * Init-param structs a driver for this interface offers.
 *
 * Every struct the driver ships is a candidate rather than only one matched by name: a
 * driver's rulesets are its own, so the structs it indexes are exactly the ones an
 * application may have to fill in.
 */
export function driver_init_parameter_candidates(interface_: string): Result<RulesetEntry[]> {
	return candidates_of(interface_, RulesetType.RT_STRUCT);
}

/** Whether `symbol` is shipped by a module implementing `interface_`. */
export function provides_interface(symbol: string, interface_: string): Result<boolean> {
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}

	const entry = registry.value.symbols.get(symbol);
	if (entry === undefined) {
		return ok(false);
	}

	return ok(entry.module.provides_interfaces?.includes(interface_) === true);
}
