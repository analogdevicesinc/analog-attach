/**
 * Bootstrap: fill in a workfile wherever there is no room for choice.
 *
 * Two kinds of step, applied one at a time until neither applies anywhere:
 *
 *   fill         an unset property with exactly one sensible value takes it: its default
 *                (the schema's, or one an override supplies), the only value an override
 *                leaves it, or a value an override forces.
 *   materialize  an unset REQUIRED reference with exactly one option gets it: a new node of
 *                the one type that fits, or the one board/driver symbol that provides it.
 *
 * Both write into the stored workfile - bootstrapped nodes and values are kept, the same as
 * typed ones. They are mutually dependent, which is why this is a loop and not two passes:
 * a filled `comm_type` pins a union member, materializing that member creates a node, and
 * that node's own defaults and references open the next steps.
 *
 * THE RULE: exactly one option, never the best one. An option is a node already in the
 * workfile that fits, a board or driver symbol that provides the type, or a type to create.
 * Bootstrap never links a reference to a node the workfile already holds - that is the
 * user's to decide - except an extern: an extern names one C global, so two nodes for it
 * would be the same thing twice, and binding to it is not a choice.
 *
 * Termination: every step sets a value that was unset or adds a node, and nothing is ever
 * unset or removed, so the loop only moves forward. The step cap is a bug detector, not the
 * stopping condition.
 */

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import type { Property, Ruleset } from "../ruleset_parser/types";
import { provided_id, RulesetType } from "../ruleset_parser/types";
import { load_resolved_ruleset, load_resolved_ruleset_for_board } from "../resolver/resolver";
import { board_externs } from "../registry/bsp";
import { driver_init_parameter_candidates, driver_ops_candidates } from "../registry/drivers";
import { all_symbols, resolve_entry } from "../registry/registry";
import { collect_child_overrides, create_connections_graph } from "../validator/connection_graph";
import { apply_overrides } from "../validator/override_resolver";
import { add_symbol, set_value } from "../workfile_handler/workfile_handler";
import type { Workfile } from "../workfile_handler/types";

/** Why a value was filled. */
export type FillSource = "default" | "only value" | "override";

export interface FilledValue {
	node: string,
	property: string,
	value: unknown,
	from: FillSource,
}

/** A reference bootstrap set, and whether it had to create the node it points at. */
export interface LinkedReference {
	node: string,
	property: string,
	/** The union member, when the reference is one. */
	member?: string,
	target: string,
	/** The schema or extern symbol of `target`. */
	symbol: string,
	created: boolean,
}

export interface BootstrapReport {
	filled: FilledValue[],
	linked: LinkedReference[],
}

/** A bug detector: well above any real graph, and only reached if a step stops making progress. */
const STEP_CAP = 1000;

// --- What can fill a reference -----------------------------------------------------------

/**
 * One option for a reference. `existing` is a node already in the workfile; `extern` and
 * `create` are symbols that are not in it yet.
 */
type Option =
	| { kind: "existing", name: string, extern: boolean }
	| { kind: "extern", symbol: string }
	| { kind: "create", symbol: string };

/** Every extern the configured modules and the selected board offer, by the type it provides. */
interface ExternIndex {
	by_type: Map<string, string[]>,
	board: Set<string>,
}

function build_extern_index(workfile: Workfile): Result<ExternIndex> {
	const by_type = new Map<string, string[]>();
	const board = new Set<string>();
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

	if (workfile.board !== undefined) {
		const externs = board_externs(workfile.board);
		if (!externs.ok) {
			return externs;
		}
		for (const extern of externs.value.externs) {
			add(extern.$provides, extern.$symbol);
			board.add(extern.$symbol);
		}
	}

	return ok({ by_type, board });
}

/**
 * The options for a reference that must name a node providing `type_`.
 *
 * A board or driver symbol providing the type is THE option, and a fresh struct of the type
 * is only considered when nothing provides one: an application references its board's bus
 * config rather than writing its own, so offering both would make every such reference look
 * like a choice when it is not.
 */
function reference_options(workfile: Workfile, type_: string, self: string, externs: ExternIndex): Option[] {
	const options: Option[] = [];
	const extern_symbols = externs.by_type.get(type_) ?? [];

	for (const [name, node] of Object.entries(workfile.symbols)) {
		if (name !== self && provided_id(node) === type_) {
			options.push({ kind: "existing", name, extern: node._t === "RulesetExtern" });
		}
	}

	for (const symbol of extern_symbols) {
		const present = Object.values(workfile.symbols).some(node => node._t === "RulesetExtern" && node.$symbol === symbol);
		if (!present) {
			options.push({ kind: "extern", symbol });
		}
	}

	if (extern_symbols.length === 0) {
		const entry = resolve_entry(type_);
		if (entry.ok && (entry.value.$type === RulesetType.RT_STRUCT || entry.value.$type === RulesetType.RT_DESCRIPTOR)) {
			options.push({ kind: "create", symbol: type_ });
		}
	}

	return options;
}

/** Options for a driver-backed reference: the providing modules' own symbols of one kind. */
function driver_options(workfile: Workfile, candidates: string[], self: string): Option[] {
	const options: Option[] = [];
	for (const symbol of candidates) {
		const present = Object.entries(workfile.symbols).filter(([name, node]) => name !== self && node.$symbol === symbol);
		for (const [name, node] of present) {
			options.push({ kind: "existing", name, extern: node._t === "RulesetExtern" });
		}
		if (present.length === 0) {
			options.push(node_kind_option(symbol));
		}
	}
	return options;
}

function node_kind_option(symbol: string): Option {
	const entry = resolve_entry(symbol);
	return entry.ok && entry.value.$type === RulesetType.RT_EXTERN ? { kind: "extern", symbol } : { kind: "create", symbol };
}

/** The one option to take, or none: anything but exactly one option, or a user-held node, is a choice. */
function the_only(options: Option[]): Option | undefined {
	const [only, ...more] = options;
	if (only === undefined || more.length > 0) {
		return undefined;
	}
	if (only.kind === "existing" && !only.extern) {
		return undefined;
	}
	return only;
}

// --- What can fill a value ---------------------------------------------------------------

function fill_value(effective: Property): { value: unknown, from: FillSource } | undefined {
	// A value an override forces is the value, whatever the default says.
	if (effective.value !== undefined) {
		return { value: effective.value, from: "override" };
	}

	switch (effective._t) {
		case "EnumProperty": {
			// An override that leaves exactly one value has decided it; a default outside the
			// allowed set would only be rejected by validation.
			const [only, ...more] = effective.values;
			if (only !== undefined && more.length === 0) {
				return { value: only, from: "only value" };
			}
			return effective.default === undefined ? undefined : { value: effective.default, from: "default" };
		}
		case "NumberProperty": {
			const [only, ...more] = effective.values ?? [];
			if (only !== undefined && more.length === 0) {
				return { value: only, from: "only value" };
			}
			return effective.default === undefined ? undefined : { value: effective.default, from: "default" };
		}
		case "BooleanProperty":
		case "StringProperty":
		case "RawProperty": {
			return effective.default === undefined ? undefined : { value: effective.default, from: "default" };
		}
		default: {
			return undefined;
		}
	}
}

// --- One step ----------------------------------------------------------------------------

type Step =
	| { kind: "fill", node: string, property: string, value: unknown, from: FillSource }
	| { kind: "link", node: string, property: string, member?: string, option: Option };

function next_step(workfile: Workfile, externs: ExternIndex): Step | undefined {
	const graph = create_connections_graph(workfile);

	// Canonical order, so the same workfile always bootstraps the same way.
	for (const name of Object.keys(workfile.symbols).sort()) {
		const node: Ruleset | undefined = workfile.symbols[name];
		if (node?._t !== "RulesetStruct" && node?._t !== "RulesetDescriptor") {
			continue;
		}

		const collected = collect_child_overrides(name, workfile, graph);

		for (const property of node.properties) {
			if (property.value !== undefined || property.readonly === true) {
				continue;
			}

			const { effective, required_reason, selected_member } = apply_overrides(property, collected, name, workfile);
			if (effective.disabled === true) {
				continue;
			}

			const filled = fill_value(effective);
			if (filled !== undefined) {
				return { kind: "fill", node: name, property: property.name, ...filled };
			}

			// A requirement that came from `$any_of` has alternatives by construction (the
			// chip-select can be a GPIO or a native line), so it is never decided here. Lists
			// (an include with a `count`) are left alone too: they need N nodes, not one.
			if (required_reason !== undefined) {
				continue;
			}

			const step = link_step(workfile, externs, name, effective, selected_member);
			if (step !== undefined) {
				return step;
			}
		}
	}

	return undefined;
}

function link_step(
	workfile: Workfile,
	externs: ExternIndex,
	name: string,
	effective: Property,
	selected_member: string | undefined,
): Step | undefined {
	const link = (option: Option | undefined, member?: string): Step | undefined => option === undefined
		? undefined
		: { kind: "link", node: name, property: effective.name, ...(member === undefined ? {} : { member }), option };

	switch (effective._t) {
		case "IncludeProperty": {
			if (effective.required !== true || effective.include === undefined || effective.count !== undefined) {
				return undefined;
			}
			return link(the_only(reference_options(workfile, effective.include, name, externs)));
		}
		case "UnionProperty": {
			// Only a member something pinned, or the only member there is.
			const [first, ...others] = effective.members;
			const member_name = selected_member ?? (others.length === 0 ? first?.name : undefined);
			const member = effective.members.find(candidate => candidate.name === member_name);
			const member_type = member?.include;
			if (member === undefined || member_type === undefined || (selected_member === undefined && effective.required !== true)) {
				return undefined;
			}
			return link(the_only(reference_options(workfile, member_type, name, externs)), member.name);
		}
		case "DriverInitParameterProperty": {
			if (effective.required !== true) {
				return undefined;
			}
			const candidates = driver_init_parameter_candidates(effective.interface);
			return candidates.ok
				? link(the_only(driver_options(workfile, candidates.value.map(entry => entry.$symbol), name)))
				: undefined;
		}
		case "DriverOpsProperty": {
			if (effective.required !== true) {
				return undefined;
			}
			const candidates = driver_ops_candidates(effective.interface);
			return candidates.ok
				? link(the_only(driver_options(workfile, candidates.value.map(entry => entry.$symbol), name)))
				: undefined;
		}
		default: {
			return undefined;
		}
	}
}

// --- Applying a step ---------------------------------------------------------------------

/** A free node name: the symbol itself, then `_1`, `_2`, ... - the same as `add` picks. */
function unique_name(workfile: Workfile, base: string): string {
	if (!(base in workfile.symbols)) {
		return base;
	}
	for (let index = 1; ; index++) {
		const candidate = `${base}_${String(index)}`;
		if (!(candidate in workfile.symbols)) {
			return candidate;
		}
	}
}

/** Put the option's node into the workfile if it is not there yet; its name either way. */
function realize(workfile: Workfile, option: Option, externs: ExternIndex): Result<{ name: string, symbol: string, created: boolean }> {
	if (option.kind === "existing") {
		const node = workfile.symbols[option.name];
		return ok({ name: option.name, symbol: node?.$symbol ?? option.name, created: false });
	}

	// A fresh copy every time: add_symbol stores the ruleset by reference and values are
	// written onto it, so a shared instance would let one node's values appear on another.
	const loaded = externs.board.has(option.symbol)
		? load_resolved_ruleset_for_board(option.symbol, workfile.board)
		: load_resolved_ruleset(option.symbol);
	if (!loaded.ok) {
		return loaded;
	}

	const name = unique_name(workfile, option.symbol);
	const added = add_symbol(workfile, name, loaded.value);
	if (!added.ok) {
		return added;
	}

	return ok({ name, symbol: option.symbol, created: true });
}

/**
 * Fill in everything that leaves no room for choice, in place, and report what was done.
 *
 * Safe to run any number of times: a second run on the result changes nothing, because
 * every step it could take was already taken.
 */
export function bootstrap(workfile: Workfile): Result<BootstrapReport> {
	const externs = build_extern_index(workfile);
	if (!externs.ok) {
		return externs;
	}

	const report: BootstrapReport = { filled: [], linked: [] };

	for (let steps = 0; steps < STEP_CAP; steps++) {
		const step = next_step(workfile, externs.value);
		if (step === undefined) {
			return ok(report);
		}

		if (step.kind === "fill") {
			const set = set_value(workfile, step.node, step.property, step.value);
			if (!set.ok) {
				return set;
			}
			report.filled.push({ node: step.node, property: step.property, value: step.value, from: step.from });
			continue;
		}

		const target = realize(workfile, step.option, externs.value);
		if (!target.ok) {
			return target;
		}

		const value = step.member === undefined ? target.value.name : { [step.member]: target.value.name };
		const set = set_value(workfile, step.node, step.property, value);
		if (!set.ok) {
			return set;
		}
		report.linked.push({
			node: step.node,
			property: step.property,
			...(step.member === undefined ? {} : { member: step.member }),
			target: target.value.name,
			symbol: target.value.symbol,
			created: target.value.created,
		});
	}

	return error(
		`Bootstrap took more than ${String(STEP_CAP)} steps without settling. That is a bug: some step is not making progress.`
	);
}
