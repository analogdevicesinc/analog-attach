/**
 * The one reader for a module's `module.yml` and for the ruleset index it points at.
 *
 * Every repo in the ecosystem — capi itself, a platform backend, a driver collection —
 * carries a `module.yml` at its root, and a module that describes C structs points at its
 * own ruleset index with `rulesets_file:`, modelled on the existing `interfaces_file:`.
 * Both files are read here so there is one place that knows their shape.
 *
 * Only the keys analog-attach needs are read. A module.yml carries plenty that belongs to
 * the build (`depends`, `provides`, `pinout`, ...); unknown keys are ignored rather than
 * rejected, because these files are owned by other repos and will grow keys without
 * asking us.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import type { ParseContext } from "../ruleset_parser/validators";
import { asObject, at, integer_, optional, required, string_, stringArray } from "../ruleset_parser/validators";
import type { ConnectorInfo, GpioIdentity, ModuleBuild, ModuleInfo, PinInfo, SocInfo } from "./types";

export const MODULE_FILENAME = "module.yml";

/** One group of ruleset files from an index, named by its `rulesets:` key. */
export interface RulesetIndexGroup {
	group: string,
	/** Paths as written in the index, relative to the index file's own directory. */
	files: string[],
}

/**
 * Which fields carry a SPI device's chip-select, declared by the module owning the generic
 * SPI structs (capi). Data rather than code so the CAPI names live in one place, next to
 * `bsp_kinds`, and the mechanism does not assume them.
 */
export interface ChipSelectBinding {
	/** The struct a SPI part is attached through, e.g. capi_spi_device. */
	device: string,
	/** Its list of GPIO chip-selects; the list's `count` field comes from the schema. */
	gpio_list: string,
	/** Its native chip-select bitmask. */
	native_mask: string,
	/** On the pin type the GPIO list includes: the pin number, and the port it is on. */
	pin_number: string,
	pin_port: string,
}

export interface RulesetIndex {
	groups: RulesetIndexGroup[],
	chip_select?: ChipSelectBinding,
	/**
	 * `bsp_kinds:` — board.yml peripheral kind to the C type it has. Declared by whichever
	 * module owns the generic structs (capi), not by each platform, so one table covers
	 * every board of every platform. See the key's own comment in capi/analog-attach.
	 */
	bsp_kinds?: Record<string, string>,
}

function read_yaml(file: string): Result<unknown> {
	let contents: string;
	try {
		contents = fs.readFileSync(file, "utf8");
	} catch {
		return error(`Failed to read ${file}`, file);
	}

	try {
		return ok(YAML.parse(contents));
	} catch (parse_error) {
		const reason = parse_error instanceof Error ? parse_error.message : String(parse_error);
		return error(`Failed to parse ${file}: ${reason}`, file);
	}
}

function parse_build(value: unknown, context: ParseContext): Result<ModuleBuild> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	const kconfig = optional(object.value, "kconfig", context, string_);
	if (!kconfig.ok) {
		return kconfig;
	}

	const sources = optional(object.value, "sources", context, stringArray);
	if (!sources.ok) {
		return sources;
	}

	const includes = optional(object.value, "includes", context, stringArray);
	if (!includes.ok) {
		return includes;
	}

	return ok({
		kconfig: kconfig.value,
		sources: sources.value,
		includes: includes.value,
	});
}

/**
 * Read the `module.yml` at the root of a module checkout.
 *
 * `root` is taken as given rather than searched upward: a module root is configured, and
 * guessing which parent directory was meant would make a typo look like a working setup.
 */
export function read_module(root: string): Result<ModuleInfo> {
	const module_path = path.resolve(root);
	const file = path.join(module_path, MODULE_FILENAME);

	if (!fs.existsSync(file)) {
		return error(`No ${MODULE_FILENAME} at module root '${module_path}'`, module_path);
	}

	const parsed = read_yaml(file);
	if (!parsed.ok) {
		return parsed;
	}

	const context: ParseContext = { path: file, document: {} };
	const object = asObject(parsed.value, context);
	if (!object.ok) {
		return object;
	}

	const name = required(object.value, "name", context, string_);
	if (!name.ok) {
		return name;
	}

	const type_ = required(object.value, "type", context, string_);
	if (!type_.ok) {
		return type_;
	}

	const description = optional(object.value, "description", context, string_);
	if (!description.ok) {
		return description;
	}

	const build = optional(object.value, "build", context, parse_build);
	if (!build.ok) {
		return build;
	}

	const rulesets_file = optional(object.value, "rulesets_file", context, string_);
	if (!rulesets_file.ok) {
		return rulesets_file;
	}

	const drivers = optional(object.value, "drivers", context, stringArray);
	if (!drivers.ok) {
		return drivers;
	}

	const boards = optional(object.value, "boards", context, stringArray);
	if (!boards.ok) {
		return boards;
	}

	const socs = optional(object.value, "socs", context, parse_socs);
	if (!socs.ok) {
		return socs;
	}

	const provides = optional(object.value, "provides", context, asObject);
	if (!provides.ok) {
		return provides;
	}

	const provides_interfaces = optional(provides.value ?? {}, "interfaces", at(context, "provides"), stringArray);
	if (!provides_interfaces.ok) {
		return provides_interfaces;
	}

	// A driver's `depends.packages`: the libraries it builds against (capi-util). Read leniently,
	// by name only - the version and source fields are the build's business, and an
	// application's `depends:` is a list of a different shape.
	const depends = object.value.depends;
	const packages = typeof depends === "object" && depends !== null && !Array.isArray(depends)
		&& Array.isArray((depends as Record<string, unknown>).packages)
		? ((depends as Record<string, unknown>).packages as unknown[])
			.map(entry => (typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).name : undefined))
			.filter((name): name is string => typeof name === "string")
		: undefined;

	const pinout = optional(object.value, "pinout", context, asObject);
	if (!pinout.ok) {
		return pinout;
	}

	const connectors = optional(pinout.value ?? {}, "connectors", at(context, "pinout"), parse_connectors);
	if (!connectors.ok) {
		return connectors;
	}

	const implements_ = optional(object.value, "implements", context, asObject);
	if (!implements_.ok) {
		return implements_;
	}

	const implements_driver = optional(implements_.value ?? {}, "driver", at(context, "implements"), string_);
	if (!implements_driver.ok) {
		return implements_driver;
	}

	const interfaces_file = optional(object.value, "interfaces_file", context, string_);
	if (!interfaces_file.ok) {
		return interfaces_file;
	}

	// `metadata:` is a free-form bag in these files, so only the two keys analog-attach
	// needs are read and an absent one is simply unset.
	const metadata = optional(object.value, "metadata", context, asObject);
	if (!metadata.ok) {
		return metadata;
	}

	// An absent `metadata:` reads the same as an empty one: every key taken from it is
	// optional, so there is nothing to branch on.
	const metadata_context = at(context, "metadata");
	const metadata_object = metadata.value ?? {};

	const vendor = optional(metadata_object, "vendor", metadata_context, string_);
	if (!vendor.ok) {
		return vendor;
	}

	const mcu = optional(metadata_object, "mcu", metadata_context, string_);
	if (!mcu.ok) {
		return mcu;
	}

	return ok({
		name: name.value,
		type: type_.value,
		path: module_path,
		description: description.value,
		build: build.value,
		rulesets_file: rulesets_file.value,
		drivers: drivers.value,
		boards: boards.value,
		socs: socs.value,
		interfaces_file: interfaces_file.value,
		vendor: vendor.value,
		mcu: mcu.value,
		connectors: connectors.value,
		implements_driver: implements_driver.value,
		provides_interfaces: provides_interfaces.value,
		...(packages === undefined ? {} : { packages }),
	});
}

/** `role:` is one role or a list of them; either way it reads as a list. */
function parse_roles(value: unknown, context: ParseContext): Result<string[]> {
	if (typeof value === "string") {
		return ok([value]);
	}
	return stringArray(value, context);
}

function parse_gpio(value: unknown, context: ParseContext): Result<GpioIdentity> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	const port = required(object.value, "port", context, string_);
	if (!port.ok) {
		return port;
	}

	const number = required(object.value, "number", context, integer_);
	if (!number.ok) {
		return number;
	}

	return ok({ port: port.value, number: number.value });
}

/**
 * A pinout's connectors.
 *
 * Only the keys analog-attach joins on are typed. `function:` and the rest are prose
 * for people and are left alone. A pin's `pin:` is kept as text because it is a header
 * position on one connector ("11") and a chip pin name on another ("P0_18").
 */
function parse_connectors(value: unknown, context: ParseContext): Result<ConnectorInfo[]> {
	if (!Array.isArray(value)) {
		return error(`Expected array, got ${typeof value}`, context.path);
	}

	const connectors: ConnectorInfo[] = [];
	for (const [index, entry] of value.entries()) {
		const connector_context = at(context, index);
		const object = asObject(entry, connector_context);
		if (!object.ok) {
			return object;
		}

		const name = required(object.value, "name", connector_context, string_);
		if (!name.ok) {
			return name;
		}

		const id = optional(object.value, "id", connector_context, string_);
		if (!id.ok) {
			return id;
		}

		const type_ = optional(object.value, "type", connector_context, string_);
		if (!type_.ok) {
			return type_;
		}

		const raw_pins = object.value.pins ?? [];
		if (!Array.isArray(raw_pins)) {
			return error(`Expected array, got ${typeof raw_pins}`, at(connector_context, "pins").path);
		}

		const pins: PinInfo[] = [];
		for (const [pin_index, raw_pin] of raw_pins.entries()) {
			const pin_context = at(at(connector_context, "pins"), pin_index);
			const pin_object = asObject(raw_pin, pin_context);
			if (!pin_object.ok) {
				return pin_object;
			}

			const pin = pin_object.value.pin;
			if (typeof pin !== "string" && typeof pin !== "number") {
				return error(`Expected a pin number or name, got ${typeof pin}`, at(pin_context, "pin").path);
			}

			const roles = optional(pin_object.value, "role", pin_context, parse_roles);
			if (!roles.ok) {
				return roles;
			}

			const mnemonic = optional(pin_object.value, "mnemonic", pin_context, string_);
			if (!mnemonic.ok) {
				return mnemonic;
			}

			const gpio = optional(pin_object.value, "gpio", pin_context, parse_gpio);
			if (!gpio.ok) {
				return gpio;
			}

			pins.push({ pin: String(pin), roles: roles.value ?? [], mnemonic: mnemonic.value, gpio: gpio.value });
		}

		connectors.push({ name: name.value, id: id.value, type: type_.value, pins });
	}

	return ok(connectors);
}

function parse_socs(value: unknown, context: ParseContext): Result<SocInfo[]> {
	if (!Array.isArray(value)) {
		return error(`Expected array, got ${typeof value}`, context.path);
	}

	const socs: SocInfo[] = [];
	for (const [index, entry] of value.entries()) {
		const element_context = at(context, index);
		const object = asObject(entry, element_context);
		if (!object.ok) {
			return object;
		}

		const name = required(object.value, "name", element_context, string_);
		if (!name.ok) {
			return name;
		}

		const arch = optional(object.value, "arch", element_context, string_);
		if (!arch.ok) {
			return arch;
		}

		const cpu = optional(object.value, "cpu", element_context, string_);
		if (!cpu.ok) {
			return cpu;
		}

		const descriptor = optional(object.value, "descriptor", element_context, string_);
		if (!descriptor.ok) {
			return descriptor;
		}

		socs.push({ name: name.value, arch: arch.value, cpu: cpu.value, descriptor: descriptor.value });
	}

	return ok(socs);
}

/**
 * Read a module's ruleset index: the file `rulesets_file:` names.
 *
 * The index groups its files under keys that mirror the directory layout (`spi`, `enums`,
 * `structs`); the grouping is kept so a symbol can be reported with the group it came
 * from, but nothing resolves through it — `$symbol` is the only identity.
 */
export function read_ruleset_index(index_file: string): Result<RulesetIndex> {
	if (!fs.existsSync(index_file)) {
		return error(`Ruleset index '${index_file}' does not exist`, index_file);
	}

	const parsed = read_yaml(index_file);
	if (!parsed.ok) {
		return parsed;
	}

	const context: ParseContext = { path: index_file, document: {} };
	const object = asObject(parsed.value, context);
	if (!object.ok) {
		return object;
	}

	const rulesets = required(object.value, "rulesets", context, asObject);
	if (!rulesets.ok) {
		return rulesets;
	}

	const groups: RulesetIndexGroup[] = [];
	for (const [group, value] of Object.entries(rulesets.value)) {
		const files = stringArray(value, at(context, group));
		if (!files.ok) {
			return files;
		}
		groups.push({ group, files: files.value });
	}

	const bsp_kinds = optional(object.value, "bsp_kinds", context, parse_string_map);
	if (!bsp_kinds.ok) {
		return bsp_kinds;
	}

	const chip_select = optional(object.value, "chip_select", context, parse_chip_select);
	if (!chip_select.ok) {
		return chip_select;
	}

	return ok({ groups, bsp_kinds: bsp_kinds.value, chip_select: chip_select.value });
}

function parse_chip_select(value: unknown, context: ParseContext): Result<ChipSelectBinding> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	const fields: Record<string, string> = {};
	for (const key of ["device", "gpio_list", "native_mask", "pin_number", "pin_port"] as const) {
		const field = required(object.value, key, context, string_);
		if (!field.ok) {
			return field;
		}
		fields[key] = field.value;
	}

	return ok(fields as unknown as ChipSelectBinding);
}

/** A flat mapping of name to name, as `bsp_kinds:` is. */
function parse_string_map(value: unknown, context: ParseContext): Result<Record<string, string>> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	const map: Record<string, string> = {};
	for (const [key, entry] of Object.entries(object.value)) {
		const text = string_(entry, at(context, key));
		if (!text.ok) {
			return text;
		}
		map[key] = text.value;
	}

	return ok(map);
}
