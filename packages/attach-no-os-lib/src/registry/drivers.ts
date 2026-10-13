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
import type { Ruleset } from "../ruleset_parser/types";
import { get_registry } from "./registry";
import { load_resolved_ruleset } from "../resolver/resolver";
import type { ModuleInfo, RulesetEntry } from "./types";
import type { Workfile } from "../workfile_handler/types";

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
	const candidates = candidates_of(interface_, RulesetType.RT_EXTERN);
	if (!candidates.ok) {
		return candidates;
	}
	// A driver providing several interfaces ships an ops table per interface (ad74413r: adc
	// and dac). Each says what it is, and an interface's table is named <interface>_ops, with
	// the framework's prefix in front (capi_adc_ops).
	const ops_type = `${interface_}_ops`;
	return ok(candidates.value.filter(entry => {
		const ruleset = load_resolved_ruleset(entry.$symbol);
		if (!ruleset.ok || ruleset.value._t !== "RulesetExtern") {
			return false;
		}
		const provides = ruleset.value.$provides;
		return provides === ops_type || provides.endsWith(`_${ops_type}`);
	}));
}

/**
 * Init-param structs a driver for this interface offers.
 *
 * Every struct the driver ships is a candidate rather than only one matched by name: a
 * driver's rulesets are its own, so the structs it indexes are exactly the ones an
 * application may have to fill in. Except a struct another of the driver's candidates
 * includes: that one is a part of it, not what a handle takes. ad7156_capi_init_param
 * embeds ad7156_init_param as `device`, so only the adapter's struct is the extra.
 */
export function driver_init_parameter_candidates(interface_: string): Result<RulesetEntry[]> {
	const candidates = candidates_of(interface_, RulesetType.RT_STRUCT);
	if (!candidates.ok) {
		return candidates;
	}
	const parts = new Set<string>();
	for (const candidate of candidates.value) {
		for (const included of included_symbols(candidate.$symbol)) {
			if (candidates.value.some(other => other.$symbol === included && other.module.path === candidate.module.path)) {
				parts.add(included);
			}
		}
	}
	return ok(candidates.value.filter(candidate => !parts.has(candidate.$symbol)));
}

/** The symbols a struct names through its includes: plain, union members and array elements. */
function included_symbols(symbol: string): string[] {
	const ruleset = load_resolved_ruleset(symbol);
	if (!ruleset.ok || ruleset.value._t !== "RulesetStruct") {
		return [];
	}
	return ruleset.value.properties.flatMap(property => {
		switch (property._t) {
			case "IncludeProperty": { return property.include === undefined ? [] : [property.include]; }
			case "UnionProperty": { return property.members.flatMap(member => (member.include === undefined ? [] : [member.include])); }
			case "ArrayProperty": { return property.element._t === "IncludeProperty" && property.element.include !== undefined ? [property.element.include] : []; }
			default: { return []; }
		}
	});
}

/**
 * The init_param `add <driver>` pins for one of its interfaces: the driver's only candidate,
 * or, when it has several (ad74413r: the chip's, and a channel's), `<driver>_init_param`.
 * None when neither settles it, which leaves the field to bootstrap's ranking.
 */
export function pinned_init_parameter(driver: ModuleInfo, interface_: string): Result<RulesetEntry | undefined> {
	const candidates = driver_init_parameter_candidates(interface_);
	if (!candidates.ok) {
		return candidates;
	}
	const own = candidates.value.filter(candidate => candidate.module.path === driver.path);
	const [only, ...more] = own;
	if (more.length === 0) {
		return ok(only);
	}
	return ok(own.find(candidate => candidate.$symbol === `${driver.name}_init_param`));
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

/** A driver-backed field's options, ranked by what the workfile already says. */
export interface RankedCandidates {
	/** From drivers that already have nodes in the workfile: the part the user added. */
	strong: RulesetEntry[],
	/** From every other configured driver providing the interface. */
	weak: RulesetEntry[],
}

/**
 * The options for a driver-backed field (`extra`, `ops`) of a node of type `owner`, deduced
 * from the workfile rather than declared:
 *
 *   - a symbol that already fills a driver-backed field at the OTHER level - a device config
 *     versus a channel config - belongs to that level: `ad74413r_init_param` filling
 *     capi_adc_config.extra is a device's, so it is not offered for capi_adc_chan_config.extra,
 *     which leaves ad74413r_channel_config. Between two device configs (ADC and DAC on one
 *     chip) the same init_param stays an option;
 *   - what is left is strong when its driver already has a node in the workfile, weak when
 *     not. With one ADC part in the workfile, its own structs are the strong options.
 */
export function rank_driver_candidates(workfile: Workfile, candidates: RulesetEntry[], owner: Ruleset): RankedCandidates {
	const taken = new Set<string>();
	const present = new Set<string>();
	const owner_level = hangs_off_handle(owner);
	for (const node of Object.values(workfile.symbols)) {
		const entry = lookup(node.$symbol);
		if (entry?.module.type === "driver") {
			present.add(entry.module.path);
		}
		// Only across levels: the chip's init_param fills both the ADC and the DAC device
		// config, but never a channel's.
		if (node.$symbol === owner.$symbol || hangs_off_handle(node) === owner_level
			|| (node._t !== "RulesetStruct" && node._t !== "RulesetDescriptor")) {
			continue;
		}
		for (const property of node.properties) {
			if ((property._t === "DriverInitParameterProperty" || property._t === "DriverOpsProperty") && typeof property.value === "string") {
				const target = workfile.symbols[property.value];
				if (target !== undefined) {
					taken.add(target.$symbol);
				}
			}
		}
	}

	const open = candidates.filter(candidate => !taken.has(candidate.$symbol));
	return {
		strong: open.filter(candidate => present.has(candidate.module.path)),
		weak: open.filter(candidate => !present.has(candidate.module.path)),
	};
}

/**
 * Whether a config hangs off a handle - a channel config names the ADC or DAC it is on
 * (`adc_handle`) - as opposed to configuring a device of its own.
 */
function hangs_off_handle(node: Ruleset): boolean {
	return node._t === "RulesetStruct" && node.properties.some(property => property._t === "IncludeProperty"
		&& property.include !== undefined && lookup(property.include)?.$type === RulesetType.RT_DESCRIPTOR);
}

function lookup(symbol: string): RulesetEntry | undefined {
	const registry = get_registry();
	return registry.ok ? registry.value.symbols.get(symbol) : undefined;
}
