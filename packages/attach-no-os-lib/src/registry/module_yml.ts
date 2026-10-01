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
import { asObject, at, optional, required, string_, stringArray } from "../ruleset_parser/validators";
import type { ModuleBuild, ModuleInfo, SocInfo } from "./types";

export const MODULE_FILENAME = "module.yml";

/** One group of ruleset files from an index, named by its `rulesets:` key. */
export interface RulesetIndexGroup {
	group: string,
	/** Paths as written in the index, relative to the index file's own directory. */
	files: string[],
}

export interface RulesetIndex {
	groups: RulesetIndexGroup[],
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
		provides_interfaces: provides_interfaces.value,
	});
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

	return ok({ groups, bsp_kinds: bsp_kinds.value });
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
