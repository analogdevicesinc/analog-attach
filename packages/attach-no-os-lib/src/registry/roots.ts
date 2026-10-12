/**
 * The node a user adds for a part: its root.
 *
 * A CAPI part is reached through a generic interface handle - the ADXL355 through a
 * `capi_accel_sensor` - whose config names only the interface it is for:
 *
 *   capi_accel_sensor_init_config
 *     extra: {type: driver_init_param, interface: accel_sensor}
 *     ops:   {type: driver_ops,        interface: accel_sensor}
 *
 * and a driver says which interfaces it implements (`provides.interfaces`). So the root for
 * a driver is a descriptor whose config has a driver-backed field for one of those
 * interfaces. Everything below the root is then bootstrap's to build.
 */

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import { RulesetType } from "../ruleset_parser/types";
import { load_resolved_ruleset } from "../resolver/resolver";
import { all_symbols, get_registry } from "./registry";
import type { ModuleInfo } from "./types";
import { IIO_GROUP } from "./drivers";

/** `module.yml` `type:` of a single-part driver. */
const MODULE_TYPE_DRIVER = "driver";

/** The interfaces a descriptor's config takes a driver for, through driver-backed fields. */
function driver_interfaces_of(descriptor_symbol: string): string[] {
	const descriptor = load_resolved_ruleset(descriptor_symbol);
	if (!descriptor.ok || descriptor.value._t !== "RulesetDescriptor") {
		return [];
	}

	const config_symbol = descriptor.value.properties[0].include;
	if (config_symbol === undefined) {
		return [];
	}

	const config = load_resolved_ruleset(config_symbol);
	if (!config.ok || config.value._t !== "RulesetStruct") {
		return [];
	}

	return config.value.properties.flatMap(property =>
		property._t === "DriverInitParameterProperty" || property._t === "DriverOpsProperty" ? [property.interface] : []
	);
}

/** Every configured driver module. */
export function list_drivers(): Result<ModuleInfo[]> {
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}
	return ok(registry.value.modules.filter(module => module.type === MODULE_TYPE_DRIVER));
}

/** The root descriptors a driver can be added through, sorted. Usually exactly one. */
export function driver_roots(driver: string): Result<string[]> {
	const drivers = list_drivers();
	if (!drivers.ok) {
		return drivers;
	}

	const module = drivers.value.find(candidate => candidate.name === driver);
	if (module === undefined) {
		return error(`No configured driver is called '${driver}'`, driver);
	}

	const provided = new Set(module.provides_interfaces ?? []);

	const entries = all_symbols();
	if (!entries.ok) {
		return entries;
	}

	const candidates = entries.value
		.filter(entry => entry.$type === RulesetType.RT_DESCRIPTOR)
		.filter(entry => driver_interfaces_of(entry.$symbol).some(interface_ => provided.has(interface_)))
		.map(entry => entry.$symbol);

	// A handle whose config takes another candidate hangs off it - an ADC channel's config
	// names the ADC it is on (capi_adc_chan_config.adc_handle) - so it is not a root.
	return ok(candidates.filter(candidate => !config_includes(candidate).some(include => candidates.includes(include))));
}

/** The types a descriptor's config includes. */
function config_includes(descriptor_symbol: string): string[] {
	const descriptor = load_resolved_ruleset(descriptor_symbol);
	const config_symbol = descriptor.ok && descriptor.value._t === "RulesetDescriptor" ? descriptor.value.properties[0].include : undefined;
	const config = config_symbol === undefined ? undefined : load_resolved_ruleset(config_symbol);
	return config?.ok === true && config.value._t === "RulesetStruct"
		? config.value.properties.flatMap(property => (property._t === "IncludeProperty" && property.include !== undefined ? [property.include] : []))
		: [];
}

/** The one root for a driver, or an error that says why there is not exactly one. */
export function driver_root(driver: string): Result<string> {
	const roots = driver_roots(driver);
	if (!roots.ok) {
		return roots;
	}

	const [only, ...more] = roots.value;
	if (only === undefined) {
		// Two different situations, and only one has a workaround.
		const drivers = list_drivers();
		const module = drivers.ok ? drivers.value.find(candidate => candidate.name === driver) : undefined;
		if (module?.rulesets_file === undefined) {
			return error(`Driver '${driver}' has no analog-attach rulesets yet, so it cannot be added`, driver);
		}
		return error(`Driver '${driver}' implements no interface that a generic handle is configured through, so there is nothing to add it by. Add its own structs instead (see: attach-noos list-devices)`, driver);
	}
	if (more.length > 0) {
		return error(`Driver '${driver}' can be added through more than one handle: ${roots.value.join(", ")}. Add the one you want by its schema name`, driver);
	}

	return ok(only);
}

/**
 * The root a driver is added through when the app serves it over IIO: the descriptor in its
 * `iio` group (capi_iio_adxl355). That handle inits the part itself from the driver's own
 * init_param, so it replaces the generic root rather than sitting next to it.
 */
export function driver_iio_root(driver: string): Result<string> {
	const drivers = list_drivers();
	if (!drivers.ok) {
		return drivers;
	}
	const module = drivers.value.find(candidate => candidate.name === driver);
	if (module === undefined) {
		return error(`No configured driver is called '${driver}'`, driver);
	}

	const entries = all_symbols();
	if (!entries.ok) {
		return entries;
	}
	const [only, ...more] = entries.value.filter(entry => entry.$type === RulesetType.RT_DESCRIPTOR
		&& entry.group === IIO_GROUP && entry.module.path === module.path);
	if (only === undefined) {
		return error(`Driver '${driver}' has no IIO device in its rulesets, so it cannot be served over IIO`, driver);
	}
	if (more.length > 0) {
		return error(`Driver '${driver}' lists more than one IIO device: ${[only, ...more].map(entry => entry.$symbol).join(", ")}`, driver);
	}
	return ok(only.$symbol);
}

/**
 * Drivers `add` accepts by name: those with exactly one root. A driver with none or several
 * is still addable through its schemas, just not by the shorthand.
 */
export function addable_drivers(): Result<string[]> {
	const drivers = list_drivers();
	if (!drivers.ok) {
		return drivers;
	}
	return ok(drivers.value
		.filter(driver => driver_root(driver.name).ok)
		.map(driver => driver.name)
		.sort());
}
