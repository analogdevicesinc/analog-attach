/**
 * The symbol index: which file defines each ruleset, and which module ships it.
 *
 * A ruleset's identity is its `$symbol`, and `include:` / `$compatible` name that symbol
 * rather than a path. That is what lets a driver's init_param reference a CAPI bus struct
 * in a different repo without either side knowing where the other is checked out — but it
 * means something has to turn a symbol into a file. This is that something.
 *
 * The index is built from the configured module roots, each of which points at its own
 * ruleset index with `rulesets_file:`:
 *
 *   <root>/module.yml  ->  rulesets_file: analog-attach/module.yml
 *                      ->  rulesets: {<group>: [<path relative to that index>, ...]}
 *                      ->  each file's $symbol is its identity
 *
 * Nothing walks a directory tree. A ruleset exists because an index lists it, so a file
 * that was added without being indexed is invisible, and an index naming a file that is
 * not there is an error rather than a silent omission.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import { get_module_roots } from "../settings/settings";
import { MODULE_FILENAME, read_module, read_ruleset_index } from "./module_yml";
import { ruleset_type_from_token } from "../ruleset_parser/types";
import type { RulesetType } from "../ruleset_parser/types";
import type { ModuleInfo, Registry, RulesetEntry } from "./types";

/**
 * The `$symbol` and `$type` a ruleset file claims, without validating the rest of it.
 *
 * Indexing must not depend on every ruleset in every checked-out repo being valid: an
 * unrelated broken file would otherwise make the whole tool unusable. Resolution re-reads
 * and fully parses the file it picks, so this only has to be right about identity and kind.
 */
function read_header(file: string): Result<{ symbol: string, type: RulesetType }> {
	let contents: string;
	try {
		contents = fs.readFileSync(file, "utf8");
	} catch {
		return error(`Failed to read ruleset '${file}'`, file);
	}

	let parsed: unknown;
	try {
		parsed = YAML.parse(contents);
	} catch (parse_error) {
		const reason = parse_error instanceof Error ? parse_error.message : String(parse_error);
		return error(`Failed to parse ruleset '${file}': ${reason}`, file);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return error(`Ruleset '${file}' is not a YAML mapping`, file);
	}

	const header = parsed as Record<string, unknown>;

	const symbol = header.$symbol;
	if (typeof symbol !== "string" || symbol.length === 0) {
		return error(`Ruleset '${file}' has no $symbol`, file);
	}

	const token = header.$type;
	if (typeof token !== "string") {
		return error(`Ruleset '${file}' has no $type`, file);
	}

	const type_ = ruleset_type_from_token(token);
	if (type_ === undefined) {
		return error(`Ruleset '${file}' has an invalid $type '${token}'`, file);
	}

	return ok({ symbol, type: type_ });
}

/** Add one module's indexed rulesets to `symbols`, rejecting a symbol claimed twice. */
function index_module(
	module: ModuleInfo,
	symbols: Map<string, RulesetEntry>,
	bsp_kinds: Map<string, string>
): Result<undefined> {
	if (module.rulesets_file === undefined) {
		return ok();
	}

	const index_file = path.join(module.path, module.rulesets_file);
	const index = read_ruleset_index(index_file);
	if (!index.ok) {
		return index;
	}

	// One table shared across modules. Two modules disagreeing about what a kind is would
	// make the answer depend on root order, so it is reported instead.
	for (const [kind, type_] of Object.entries(index.value.bsp_kinds ?? {})) {
		const existing = bsp_kinds.get(kind);
		if (existing !== undefined && existing !== type_) {
			return error(
				`Board peripheral kind '${kind}' is declared as both '${existing}' and '${type_}'`,
				index_file
			);
		}
		bsp_kinds.set(kind, type_);
	}

	// Paths in an index are relative to the index file, not to the module root, so the
	// index can live in a subdirectory alongside the rulesets it lists.
	const index_directory = path.dirname(index_file);

	for (const { group, files } of index.value.groups) {
		for (const relative of files) {
			const file = path.join(index_directory, relative);
			if (!fs.existsSync(file)) {
				return error(`Ruleset index '${index_file}' lists '${relative}', which does not exist`, index_file);
			}

			const header = read_header(file);
			if (!header.ok) {
				return header;
			}

			// A symbol is a C symbol: two files claiming one would be a link error in the
			// firmware long before it is a problem here, so it is reported as the
			// collision it is rather than resolved by precedence.
			const existing = symbols.get(header.value.symbol);
			if (existing !== undefined) {
				return error(
					`Symbol '${header.value.symbol}' is defined twice: '${existing.file}' and '${file}'`,
					file
				);
			}

			symbols.set(header.value.symbol, {
				$symbol: header.value.symbol,
				$type: header.value.type,
				file,
				group,
				module,
			});
		}
	}

	return ok();
}

/** `module.yml` `type:` of a bundle of drivers, e.g. capi-noos. */
const MODULE_TYPE_DRIVER_COLLECTION = "driver_collection";
/** `module.yml` `type:` of one `drivers/<category>/` index, which declares `drivers:`. */
const MODULE_TYPE_DRIVER_CATEGORY = "driver_category";
/** Where a driver collection keeps its categories. See `collect_modules`. */
const DRIVERS_SUBDIR = "drivers";

/**
 * Every module reachable from one configured root, the root included.
 *
 * A root is rarely one module: capi-noos is a `driver_collection` whose rulesets live
 * three levels down, on the individual drivers. So the graph is walked rather than the
 * root read alone. Each hop follows what a module declares:
 *
 *   driver_collection -> drivers/<category>/        (NOT declared -- see below)
 *   driver_category   -> its `drivers:` list, as directories beside it
 *   driver            -> its own `rulesets_file:`
 *
 * One hop is a convention rather than a declaration: a `driver_collection` does not list
 * its categories anywhere, so they are found as the subdirectories of `drivers/` that
 * carry a `module.yml` — the layout the type's own definition describes. Everything below
 * that is declared. If a `categories:` key is ever added upstream, read it here and the
 * convention goes away.
 *
 * A module that declares neither children nor rulesets simply contributes nothing; eval
 * boards and projects are not walked, because nothing in them carries rulesets today.
 */
function collect_modules(root: string): Result<ModuleInfo[]> {
	const module = read_module(root);
	if (!module.ok) {
		return module;
	}

	const collected = [module.value];

	const children: string[] = [];
	if (module.value.type === MODULE_TYPE_DRIVER_COLLECTION) {
		const drivers_directory = path.join(module.value.path, DRIVERS_SUBDIR);
		if (fs.existsSync(drivers_directory)) {
			for (const entry of fs.readdirSync(drivers_directory, { withFileTypes: true })) {
				const candidate = path.join(drivers_directory, entry.name);
				if (entry.isDirectory() && fs.existsSync(path.join(candidate, MODULE_FILENAME))) {
					children.push(candidate);
				}
			}
		}
	} else if (module.value.type === MODULE_TYPE_DRIVER_CATEGORY) {
		for (const driver of module.value.drivers ?? []) {
			children.push(path.join(module.value.path, driver));
		}
	}

	for (const child of children) {
		const nested = collect_modules(child);
		if (!nested.ok) {
			return nested;
		}
		collected.push(...nested.value);
	}

	return ok(collected);
}

/** Build the index from an explicit set of module roots. */
export function build_registry(roots: string[]): Result<Registry> {
	const modules: ModuleInfo[] = [];
	const symbols = new Map<string, RulesetEntry>();
	const bsp_kinds = new Map<string, string>();

	for (const root of roots) {
		const reachable = collect_modules(root);
		if (!reachable.ok) {
			return reachable;
		}

		for (const module of reachable.value) {
			const indexed = index_module(module, symbols, bsp_kinds);
			if (!indexed.ok) {
				return indexed;
			}
			modules.push(module);
		}
	}

	return ok({ modules, symbols, bsp_kinds });
}

let cached: Registry | undefined;

/**
 * The index for this process, built on first use from the configured module roots.
 *
 * Held for the life of the process rather than cached on disk: a CLI invocation reads the
 * indexes once and exits, and a stale on-disk cache would be a worse failure than the
 * read it saves. A long-lived caller that changes the settings calls `reset_registry()`.
 */
export function get_registry(): Result<Registry> {
	if (cached !== undefined) {
		return ok(cached);
	}

	const roots = get_module_roots();
	if (!roots.ok) {
		return roots;
	}

	const built = build_registry(roots.value);
	if (!built.ok) {
		return built;
	}

	cached = built.value;
	return built;
}

/** Drop the process-wide index, so the next use rebuilds it. For tests and settings changes. */
export function reset_registry(): void {
	cached = undefined;
}

/**
 * The entry for one symbol.
 *
 * The error names the symbol that was wanted, because the caller is resolving an
 * `include:` or a `$compatible` and that string is the only thing the author wrote.
 */
export function resolve_entry(symbol: string): Result<RulesetEntry> {
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}

	const entry = registry.value.symbols.get(symbol);
	if (entry === undefined) {
		return error(`Unknown ruleset '${symbol}': no module in the configured roots defines it`, symbol);
	}

	return ok(entry);
}

/** Every indexed symbol, sorted. The whole-set read that `list` and suggestions need. */
export function all_symbols(): Result<RulesetEntry[]> {
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}

	return ok([...registry.value.symbols.values()].sort((a, b) => a.$symbol.localeCompare(b.$symbol)));
}

/**
 * Whether a symbol comes from a platform backend.
 *
 * What makes a struct a platform-specific one is that a platform module ships it, which
 * the registry already records. This replaces the old `platforms/` directory convention,
 * where the answer was "it sits under that path".
 */
export function is_platform_symbol(symbol: string): boolean {
	const entry = resolve_entry(symbol);
	return entry.ok && entry.value.module.type === MODULE_TYPE_PLATFORM;
}

/** `module.yml` `type:` of a platform backend, e.g. capi-maxim. */
export const MODULE_TYPE_PLATFORM = "platform";
