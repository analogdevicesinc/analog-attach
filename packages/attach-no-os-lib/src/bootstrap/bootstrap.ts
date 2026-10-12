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
 * workfile that fits, a hidden resource that provides the type (a board or driver extern,
 * or the handle wrapping one - see registry/hidden.ts), or a type to create. Bootstrap never
 * links a reference to a node the user's workfile holds - that is the user's to decide -
 * except a hidden one: a hidden node IS one board or driver resource, so binding to it is
 * not a choice, and is how two devices on one bus share its controller.
 *
 * Hidden nodes are created hidden: they are referenced, validated and generated like any
 * other node, but never written out; the next load rebuilds them from the name.
 *
 * Then the chip-select. Once nothing else applies, a SPI device that still has no chip-
 * select gets the one its part's wiring resolves to (registry/wiring.ts): a native line, or
 * a GPIO pin node on the right port. The same wiring settles which bus the device is on,
 * which is what decides the controller on a board with more than one SPI.
 *
 * The report says what was done and where it stopped: every bus device this run touched
 * gets its wiring instructions (or why the wiring does not add up), and every required
 * reference still open is listed with the options that made it a choice.
 *
 * Before any of that, the values bootstrap already owns ("$auto") follow the current rules:
 * a plain value is set to what its fill rule gives now, or removed when it gives nothing; a
 * reference is removed when the node it names no longer fits there. Values the user wrote are
 * never touched. The chip-select fields follow the wiring instead, and are left as they are.
 *
 * Termination: a revision only ever writes what the fill rule gives, which the fill and link
 * steps then leave alone, and they only fill unset values or add nodes - so nothing flips back
 * and forth. The step cap is a bug detector, not the stopping condition.
 */

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import type { IncludeProperty, NumberFormat, Property, Ruleset } from "../ruleset_parser/types";
import { provided_id, RulesetType } from "../ruleset_parser/types";
import { load_resolved_ruleset, load_resolved_ruleset_for_board } from "../resolver/resolver";
import type { ChipSelectBinding } from "../registry/module_yml";
import type { RulesetEntry } from "../registry/types";
import { driver_init_parameter_candidates, driver_ops_candidates, rank_driver_candidates } from "../registry/drivers";
import { build_extern_index, hidden_candidates, wrapper_name } from "../registry/hidden";
import type { ExternIndex, HiddenCandidate } from "../registry/hidden";
import { board_gpio_ports } from "../registry/bsp";
import type { PinReference } from "../registry/bsp";
import type { GpioIdentity } from "../registry/types";
import { get_registry, resolve_entry } from "../registry/registry";
import { find_eval_board, resolve_bus } from "../registry/wiring";
import type { ChipSelect, Connection, TakenChipSelects } from "../registry/wiring";
import { collect_child_overrides, create_connections_graph, is_referenced_by_others } from "../validator/connection_graph";
import type { ConnectionGraph } from "../validator/types";
import { apply_overrides } from "../validator/override_resolver";
import { add_symbol, is_hidden, mark_auto, remove_symbol, materialize_hidden, materialize_referenced_hidden, set_value } from "../workfile_handler/workfile_handler";
import type { Workfile } from "../workfile_handler/types";

/** Why a value was filled. */
export type FillSource = "default" | "only value" | "override";

export interface FilledValue {
	node: string,
	property: string,
	value: unknown,
	from: FillSource,
	/** How the field reads, for showing the value the way the schema writes it. */
	format?: NumberFormat,
}

/** A value bootstrap owned and had to change, because the rules no longer give it. */
export interface RevisedValue {
	node: string,
	property: string,
	previous: unknown,
	/** The new value, or undefined when nothing fills it any more and it was removed. */
	value?: unknown,
	format?: NumberFormat,
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
	/** Whether `target` is hidden: never written out, rebuilt from its name. */
	hidden: boolean,
}

/** How a SPI device's chip-select was settled. The wiring behind it is in `wiring`. */
export interface ChipSelectDecision {
	device: string,
	/** The part whose wiring decided it, by its eval board. */
	part: string,
	chip_select: ChipSelect,
	/** The GPIO pin node created for it, when it is a GPIO. */
	pin?: string,
}

/** How one part is wired to the board over one bus device. */
export interface BusWiring {
	/** The bus device node: a capi_spi_device, a capi_i2c_device. */
	device: string,
	/** The part, by its eval board. */
	part: string,
	/** The bus, as the part's pin roles name it: spi, i2c. */
	interface: string,
	/** The board bus its lines land on, when they agree on one. */
	peripheral?: string,
	/** The wiring instructions: connect each part pin to this board pin. */
	connections: Connection[],
	/** Wiring that does not add up, or that the board alone cannot decide. */
	problems: string[],
	/**
	 * When the chip-select could not be settled: header pins that could carry it, free of
	 * other devices and other bus signals - the board's declared lines first. A hint, not a
	 * choice made.
	 */
	chip_select_options?: { at: PinReference, gpio?: GpioIdentity }[],
}

/** A required reference bootstrap left open, because it is a choice. */
export interface OpenChoice {
	node: string,
	property: string,
	/** The union member, when the reference is one. */
	member?: string,
	/**
	 * What could fill it, by the name `update` takes. A type that would be created is
	 * listed by its symbol. Empty when nothing configured provides it at all.
	 */
	options: string[],
}

export interface BootstrapReport {
	/** Owned values changed or removed to follow the current rules. */
	revised: RevisedValue[],
	filled: FilledValue[],
	linked: LinkedReference[],
	chip_selects: ChipSelectDecision[],
	/** Wiring for every bus device this run created or connected. */
	wiring: BusWiring[],
	/** Where bootstrap stopped: the required references still open, with their options. */
	choices: OpenChoice[],
	/** Stored nodes deleted: they lost their last reference, and every value was bootstrap's. */
	deleted: string[],
	/** Stored nodes that lost their last reference but hold values the user wrote, so stay. */
	dangling: string[],
}

export interface BootstrapOptions {
	/**
	 * The nodes something referenced before the command that led to this run. A node one
	 * of them lost its last reference to - by the user's edit or by bootstrap - may be
	 * deleted. Defaults to what is referenced when the run starts.
	 */
	referenced_before?: Iterable<string>,
}

/** A bug detector: well above any real graph, and only reached if a step stops making progress. */
const STEP_CAP = 1000;

// --- What can fill a reference -----------------------------------------------------------

/**
 * One option for a reference. `existing` is a node already in the workfile, `bindable`
 * when it is a hidden resource (so linking to it is not a choice); `hidden` is a resource
 * not in the workfile yet; `create` is a new stored node of a type.
 */
type Option =
	| { kind: "existing", name: string }
	| { kind: "hidden", candidate: HiddenCandidate }
	| { kind: "create", symbol: string };

/**
 * A node already in the workfile, as an option - or not one at all. A hidden resource, an
 * extern or a handle (a descriptor: a runtime object many can point at, like a bus
 * controller) is shared, so it is an option even when something already uses it. A plain
 * struct belongs to whatever points at it: it is an option only while nothing does - a
 * dangling node, left by the user or by an earlier run, is there to be reused.
 */
function existing_option(workfile: Workfile, name: string, node: Ruleset, graph: ConnectionGraph): Option | undefined {
	const shared = is_hidden(workfile, name) || node._t === "RulesetExtern" || node._t === "RulesetDescriptor";
	return shared || !is_referenced_by_others(name, graph) ? { kind: "existing", name } : undefined;
}

/**
 * The options for a reference that must name a node providing `type_`.
 *
 * A hidden resource providing the type is THE option, and a fresh node of the type is only
 * considered when nothing provides one: an application references its board's bus config
 * and the handle wrapping it rather than writing its own, so offering both would make every
 * such reference look like a choice when it is not.
 */
function reference_options(workfile: Workfile, type_: string, self: string, externs: ExternIndex): Option[] {
	const options: Option[] = [];
	const graph = create_connections_graph(workfile);

	for (const [name, node] of Object.entries(workfile.symbols)) {
		const option = name === self || provided_id(node) !== type_ ? undefined : existing_option(workfile, name, node, graph);
		if (option !== undefined) {
			options.push(option);
		}
	}

	const candidates = hidden_candidates(type_, externs);
	for (const candidate of candidates) {
		// An extern already in the workfile under ANY name is that resource - one C global -
		// so it is not a second option.
		const held = candidate.name in workfile.symbols
			|| (candidate.kind === "extern" && Object.values(workfile.symbols).some(node => node._t === "RulesetExtern" && node.$symbol === candidate.symbol));
		if (!held) {
			options.push({ kind: "hidden", candidate });
		}
	}

	// Reusing a node beats making one, so a new node is only an option when none fits.
	if (candidates.length === 0 && options.length === 0) {
		const entry = resolve_entry(type_);
		if (entry.ok && (entry.value.$type === RulesetType.RT_STRUCT || entry.value.$type === RulesetType.RT_DESCRIPTOR)) {
			options.push({ kind: "create", symbol: type_ });
		}
	}

	return options;
}

/**
 * The driver symbols bootstrap considers for a driver-backed field of node `self`: the strong
 * ones (from parts already in the workfile) when there are any, else all that are left.
 */
function preferred(workfile: Workfile, candidates: RulesetEntry[], self: string): string[] {
	const owner = workfile.symbols[self];
	if (owner === undefined) {
		return candidates.map(entry => entry.$symbol);
	}
	const { strong, weak } = rank_driver_candidates(workfile, candidates, owner);
	return (strong.length > 0 ? strong : weak).map(entry => entry.$symbol);
}

/** Options for a driver-backed reference: the providing modules' own symbols of one kind. */
function driver_options(workfile: Workfile, candidates: string[], self: string): Option[] {
	const options: Option[] = [];
	const graph = create_connections_graph(workfile);
	for (const symbol of candidates) {
		const present = Object.entries(workfile.symbols)
			.filter(([name, node]) => name !== self && node.$symbol === symbol)
			.map(([name, node]) => existing_option(workfile, name, node, graph))
			.filter((option): option is Option => option !== undefined);
		options.push(...present);
		if (present.length > 0) {
			continue;
		}
		// A driver's ops table is an extern: hidden, named by its own symbol.
		const entry = resolve_entry(symbol);
		options.push(entry.ok && entry.value.$type === RulesetType.RT_EXTERN
			? { kind: "hidden", candidate: { kind: "extern", name: symbol, symbol } }
			: { kind: "create", symbol });
	}
	return options;
}

/** The one option to take, or none: anything but exactly one option is a choice. */
function the_only(options: Option[]): Option | undefined {
	const [only, ...more] = options;
	return more.length === 0 ? only : undefined;
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

// --- Following the rules -----------------------------------------------------------------

/**
 * The fields a chip-select decision writes, by schema: the device's mask and pin list, and
 * the pin's number and port. They come from the wiring, not the fill rule, so the
 * rule cannot revise them.
 */
function wiring_fields(binding: ChipSelectBinding | undefined): Map<string, Set<string>> {
	const fields = new Map<string, Set<string>>();
	if (binding === undefined) {
		return fields;
	}
	const device = load_resolved_ruleset(binding.device);
	const list = device.ok && device.value._t === "RulesetStruct"
		? device.value.properties.find(property => property.name === binding.gpio_list)
		: undefined;
	// The list's count is not one of them: it follows its list, like every count does.
	fields.set(binding.device, new Set([binding.native_mask, binding.gpio_list]));
	if (list?._t === "IncludeProperty" && list.include !== undefined) {
		fields.set(list.include, new Set([binding.pin_number, binding.pin_port]));
	}
	return fields;
}

/** How many entries a list value holds: one name, or an array of them. Undefined when unset. */
function list_length(value: unknown): number | undefined {
	if (Array.isArray(value)) {
		return value.length === 0 ? undefined : value.length;
	}
	return value === undefined ? undefined : 1;
}

/** Whether a reference bootstrap set still names a node that fits where it is. */
function still_fits(workfile: Workfile, effective: Property, value: unknown, selected_member: string | undefined): boolean {
	const provides = (target: unknown, type_: string | undefined): boolean => {
		const node = typeof target === "string" ? workfile.symbols[target] : undefined;
		return node !== undefined && type_ !== undefined && provided_id(node) === type_;
	};

	switch (effective._t) {
		case "IncludeProperty": {
			// A list is never bootstrap's except as a chip-select, which the wiring owns.
			return effective.count !== undefined || provides(value, effective.include);
		}
		case "UnionProperty": {
			const [entry, ...more] = typeof value === "object" && value !== null ? Object.entries(value as Record<string, unknown>) : [];
			if (entry === undefined || more.length > 0) {
				return false;
			}
			const [member_name, target] = entry;
			const member = effective.members.find(candidate => candidate.name === member_name);
			return member !== undefined
				&& (selected_member === undefined || selected_member === member_name)
				&& provides(target, member.include);
		}
		case "DriverInitParameterProperty":
		case "DriverOpsProperty": {
			const candidates = effective._t === "DriverOpsProperty"
				? driver_ops_candidates(effective.interface)
				: driver_init_parameter_candidates(effective.interface);
			const node = typeof value === "string" ? workfile.symbols[value] : undefined;
			return candidates.ok && node !== undefined && candidates.value.some(entry => entry.$symbol === node.$symbol);
		}
		default: {
			return true;
		}
	}
}

/**
 * The first value bootstrap owns that the rules no longer give: a plain value whose fill
 * rule now says something else (or nothing), or a reference that no longer fits. One at a
 * time, because removing one can change the overrides that apply to the next.
 */
function revise_step(workfile: Workfile, wiring: Map<string, Set<string>>): Step | undefined {
	const graph = create_connections_graph(workfile);

	for (const name of Object.keys(workfile.symbols).sort()) {
		const node: Ruleset | undefined = workfile.symbols[name];
		if ((node?._t !== "RulesetStruct" && node?._t !== "RulesetDescriptor") || is_hidden(workfile, name)) {
			continue;
		}

		const collected = collect_child_overrides(name, workfile, graph);
		const fixed = wiring.get(node.$symbol);

		for (const property of node.properties) {
			const previous = property.value;
			if (property.auto !== true || previous === undefined || fixed?.has(property.name) === true) {
				continue;
			}

			// A list's count is the length of its list: gone with it, and right for it.
			const list = node.properties.find(candidate => candidate._t === "IncludeProperty" && candidate.count === property.name);
			if (list !== undefined) {
				const length = list_length(list.value);
				if (length === undefined) {
					return { kind: "revise", node: name, property: property.name, previous };
				}
				if (length !== previous) {
					return { kind: "revise", node: name, property: property.name, previous, value: length };
				}
				continue;
			}

			// Judged as if unset: what would bootstrap write here now?
			const unset = { ...property, value: undefined };
			const { effective, selected_member } = apply_overrides(unset, collected, name, workfile);
			const remove: Step = { kind: "revise", node: name, property: property.name, previous };

			if (effective.disabled === true) {
				return remove;
			}

			switch (effective._t) {
				case "IncludeProperty":
				case "UnionProperty":
				case "DriverInitParameterProperty":
				case "DriverOpsProperty": {
					if (!still_fits(workfile, effective, previous, selected_member)) {
						return remove;
					}
					break;
				}
				default: {
					const filled = fill_value(effective);
					if (filled === undefined) {
						return remove;
					}
					if (JSON.stringify(filled.value) !== JSON.stringify(previous)) {
						return { ...remove, value: filled.value };
					}
				}
			}
		}
	}

	return undefined;
}

// --- Dropping what is no longer used --------------------------------------------------------

/** Every node something in the workfile references. */
export function referenced_nodes(workfile: Workfile): Set<string> {
	const graph = create_connections_graph(workfile);
	return new Set([...graph.values()].flatMap(children => children.map(child => child.name)));
}

/** Whether every value a node holds is bootstrap's: nothing the user wrote, or cleared, is lost by deleting it. */
function owned_entirely(node: Ruleset): boolean {
	return (node._t === "RulesetStruct" || node._t === "RulesetDescriptor")
		&& node.properties.every(property => property.cleared !== true && (property.value === undefined || property.auto === true));
}

/**
 * The first node that lost its last reference and can go: a hidden one (a board or driver
 * resource, rebuilt whenever it is named again), or a stored one bootstrap owns entirely.
 * Roots were never referenced, so they are never dropped.
 */
function drop_step(workfile: Workfile, watched: Set<string>): Step | undefined {
	const referenced = referenced_nodes(workfile);
	for (const name of Object.keys(workfile.symbols).sort()) {
		const node = workfile.symbols[name];
		if (!watched.has(name) || referenced.has(name) || node === undefined) {
			continue;
		}
		if (is_hidden(workfile, name) || owned_entirely(node)) {
			return { kind: "drop", node: name };
		}
	}
	return undefined;
}

// --- One step ----------------------------------------------------------------------------

type Step =
	| { kind: "drop", node: string }
	| { kind: "revise", node: string, property: string, previous: unknown, value?: unknown }
	| { kind: "fill", node: string, property: string, value: unknown, from: FillSource }
	| { kind: "link", node: string, property: string, member?: string, option: Option }
	| { kind: "chip_select", device: string, part: string, resolved: ChipSelect };

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
			if (property.value !== undefined || property.cleared === true || property.readonly === true) {
				continue;
			}

			const { effective, required_reason, selected_member } = apply_overrides(property, collected, name, workfile);
			if (effective.disabled === true) {
				continue;
			}

			// A list's count has exactly one value once the list is set: its length.
			const list = node.properties.find(candidate => candidate._t === "IncludeProperty" && candidate.count === property.name);
			const length = list === undefined ? undefined : list_length(list.value);
			if (length !== undefined) {
				return { kind: "fill", node: name, property: property.name, value: length, from: "only value" };
			}

			const filled = fill_value(effective);
			if (filled !== undefined) {
				return { kind: "fill", node: name, property: property.name, ...filled };
			}

			// A requirement that came from `$any_of` has alternatives by construction (the
			// chip-select can be a GPIO or a native line), so it is never decided here - the
			// chip-select step below is what settles that one, from the wiring.
			if (required_reason !== undefined) {
				continue;
			}

			const step = link_step(workfile, externs, name, effective, selected_member);
			if (step !== undefined) {
				return step;
			}
		}
	}

	return chip_select_step(workfile, externs);
}

function link_step(
	workfile: Workfile,
	externs: ExternIndex,
	name: string,
	effective: Property,
	selected_member: string | undefined,
): Step | undefined {
	const open = open_reference(workfile, externs, name, effective, selected_member);
	const option = open === undefined ? undefined : the_only(open.options);
	return open === undefined || option === undefined
		? undefined
		: { kind: "link", node: name, property: effective.name, ...(open.member === undefined ? {} : { member: open.member }), option };
}

/**
 * The options for an unset reference bootstrap may fill, or undefined for one it never fills
 * (an optional reference, a list, a union no one has picked a member of).
 */
function open_reference(
	workfile: Workfile,
	externs: ExternIndex,
	name: string,
	effective: Property,
	selected_member: string | undefined,
): { member?: string, options: Option[] } | undefined {
	switch (effective._t) {
		case "IncludeProperty": {
			// Lists (an include with a `count`) need N nodes, not one; they are left alone.
			if (effective.required !== true || effective.include === undefined || effective.count !== undefined) {
				return undefined;
			}
			return { options: reference_options(workfile, effective.include, name, externs) };
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
			return { member: member.name, options: reference_options(workfile, member_type, name, externs) };
		}
		case "DriverInitParameterProperty": {
			if (effective.required !== true) {
				return undefined;
			}
			const candidates = driver_init_parameter_candidates(effective.interface);
			return candidates.ok
				? { options: driver_options(workfile, preferred(workfile, candidates.value, name), name) }
				: undefined;
		}
		case "DriverOpsProperty": {
			if (effective.required !== true) {
				return undefined;
			}
			const candidates = driver_ops_candidates(effective.interface);
			return candidates.ok
				? { options: driver_options(workfile, preferred(workfile, candidates.value, name), name) }
				: undefined;
		}
		default: {
			return undefined;
		}
	}
}

// --- The chip-select ---------------------------------------------------------------------

function value_of(node: Ruleset | undefined, property: string): unknown {
	return node?._t === "RulesetStruct" || node?._t === "RulesetDescriptor"
		? node.properties.find(candidate => candidate.name === property)?.value
		: undefined;
}

/** Whether a SPI device can already be selected: a GPIO list, or a native mask that selects something. */
function has_chip_select(node: Ruleset | undefined, binding: ChipSelectBinding): boolean {
	const native = value_of(node, binding.native_mask);
	return value_of(node, binding.gpio_list) !== undefined || (typeof native === "number" && native !== 0);
}

/** The board extern a handle node wraps (bsp_gpio2_cfg_handle -> bsp_gpio2_cfg), when it is one. */
function wrapped_extern(workfile: Workfile, handle: unknown): string | undefined {
	const node = typeof handle === "string" ? workfile.symbols[handle] : undefined;
	const wrapped = value_of(node, "$init_param");
	return typeof wrapped === "string" && workfile.symbols[wrapped]?._t === "RulesetExtern" ? wrapped : undefined;
}

/**
 * The chip-select lines every SPI device but `device` already uses: each GPIO pin by its chip
 * port and number, each native line by its controller and bit.
 */
function taken_chip_selects(workfile: Workfile, device: string, binding: ChipSelectBinding): TakenChipSelects {
	const taken: TakenChipSelects = { gpio: [], native: [] };
	if (workfile.board === undefined) {
		return taken;
	}
	const ports = board_gpio_ports(workfile.board);
	const port_of = new Map([...(ports.ok ? ports.value : new Map<string, string>())].map(([port, extern]) => [extern, port]));

	for (const [name, node] of Object.entries(workfile.symbols)) {
		if (name === device || node.$symbol !== binding.device) {
			continue;
		}

		const pins = value_of(node, binding.gpio_list);
		for (const pin of Array.isArray(pins) ? pins : [pins]) {
			const pin_node = typeof pin === "string" ? workfile.symbols[pin] : undefined;
			const port = port_of.get(wrapped_extern(workfile, value_of(pin_node, binding.pin_port)) ?? "");
			const number = value_of(pin_node, binding.pin_number);
			if (port !== undefined && typeof number === "number") {
				taken.gpio.push({ port, number });
			}
		}

		const mask = value_of(node, binding.native_mask);
		// The bus it is on: the one reference that names a board handle (its controller).
		const peripheral = node._t === "RulesetStruct"
			? node.properties.map(property => wrapped_extern(workfile, property.value)).find(extern => extern !== undefined)
			: undefined;
		if (typeof mask === "number" && peripheral !== undefined) {
			for (let bit = 0; bit < 32; bit++) {
				if ((mask & (1 << bit)) !== 0) {
					taken.native.push({ peripheral, native_cs: bit });
				}
			}
		}
	}
	return taken;
}

/** Whether the user set either chip-select field to nothing: their call, not the wiring's. */
function chip_select_cleared(node: Ruleset | undefined, binding: ChipSelectBinding): boolean {
	return node?._t === "RulesetStruct" && node.properties.some(property =>
		(property.name === binding.gpio_list || property.name === binding.native_mask) && property.cleared === true);
}

/** A part's init_param bound to a bus device through a union. */
interface PartOnBus {
	part_node: string,
	device: string,
	driver: string,
	/** The bus, from the group the device's ruleset is listed under: spi, i2c. */
	interface: string,
}

/** Every (driver node, bus device node) pair in the workfile. */
function parts_on_bus(workfile: Workfile): PartOnBus[] {
	const pairs: PartOnBus[] = [];
	const registry = get_registry();
	const bus_kinds = new Set(registry.ok ? registry.value.bsp_kinds.keys() : []);
	for (const name of Object.keys(workfile.symbols).sort()) {
		const node = workfile.symbols[name];
		if (node?._t !== "RulesetStruct") {
			continue;
		}
		const entry = resolve_entry(node.$symbol);
		if (!entry.ok || entry.value.module.type !== "driver") {
			continue;
		}
		for (const property of node.properties) {
			// A bus device is reached through a union member (adxl355's comm_init) or a plain
			// include (ad74413r's spi_dev).
			const targets = property._t === "UnionProperty" && typeof property.value === "object" && property.value !== null
				? Object.values(property.value as Record<string, unknown>)
				: (property._t === "IncludeProperty" ? [property.value] : []);
			for (const target of targets) {
				const device = typeof target === "string" ? workfile.symbols[target] : undefined;
				const device_entry = device === undefined ? undefined : resolve_entry(device.$symbol);
				// Only a device on a board bus kind (spi, i2c, ...): a reset GPIO pin is not one.
				if (typeof target === "string" && device_entry?.ok === true && bus_kinds.has(device_entry.value.group)) {
					pairs.push({ part_node: name, device: target, driver: entry.value.module.name, interface: device_entry.value.group });
				}
			}
		}
	}
	return pairs;
}

/**
 * The next thing the wiring settles for a SPI device without a chip-select: first its bus,
 * if the device's controller is still open; then its chip-select.
 */
function chip_select_step(workfile: Workfile, externs: ExternIndex): Step | undefined {
	const binding = get_registry();
	if (!binding.ok || binding.value.chip_select === undefined || workfile.board === undefined) {
		return undefined;
	}
	const chip_select = binding.value.chip_select;

	for (const { device, driver } of parts_on_bus(workfile)) {
		const device_node = workfile.symbols[device];
		if (device_node?.$symbol !== chip_select.device) {
			continue;
		}
		if (has_chip_select(device_node, chip_select) || chip_select_cleared(device_node, chip_select) || device_node._t !== "RulesetStruct") {
			continue;
		}

		// Only a part whose eval board is known can be wired; anything else stays a question.
		const part = find_eval_board(driver);
		if (!part.ok) {
			continue;
		}
		const resolved = resolve_bus(part.value, workfile.board, "spi", [], taken_chip_selects(workfile, device, chip_select));
		if (!resolved.ok) {
			continue;
		}

		// The bus the part's lines land on decides the controller, where the board alone
		// could not (two SPI buses means two controller handles to choose from).
		const peripheral = resolved.value.peripheral;
		if (peripheral !== undefined) {
			for (const property of device_node.properties) {
				if (property._t !== "IncludeProperty" || property.value !== undefined || property.cleared === true || property.include === undefined) {
					continue;
				}
				const handle = hidden_candidates(property.include, externs).find(candidate => candidate.name === wrapper_name(peripheral));
				if (handle !== undefined) {
					return { kind: "link", node: device, property: property.name, option: { kind: "hidden", candidate: handle } };
				}
			}
		}

		const decided = resolved.value.chip_select;
		if (decided === undefined || decided.kind === "unwired") {
			continue;
		}
		if (decided.kind === "gpio" && decided.port_extern === undefined) {
			continue; // the board's BSP configures no port for that pin; resolve_bus says so
		}

		return { kind: "chip_select", device, part: part.value.name, resolved: decided };
	}

	return undefined;
}

/** Give a SPI device its chip-select: a native mask, or a GPIO pin node on the right port. */
function apply_chip_select(
	workfile: Workfile,
	externs: ExternIndex,
	device: string,
	resolved: ChipSelect,
	binding: ChipSelectBinding,
): Result<{ pin?: string, filled: FilledValue[], linked: LinkedReference[] }> {
	if (resolved.kind === "native") {
		const mask = 1 << resolved.native_cs;
		const set = set_owned(workfile, device, binding.native_mask, mask);
		if (!set.ok) {
			return set;
		}
		return ok({ filled: [filled_value(workfile, device, binding.native_mask, mask, "only value")], linked: [] });
	}
	if (resolved.kind !== "gpio" || resolved.port_extern === undefined) {
		return error(`Chip-select for '${device}' is not one that can be applied`, device);
	}

	const device_node = workfile.symbols[device];
	const list = device_node?._t === "RulesetStruct"
		? device_node.properties.find((property): property is IncludeProperty => property.name === binding.gpio_list && property._t === "IncludeProperty")
		: undefined;
	if (list?.include === undefined) {
		return error(`'${device}' has no ${binding.gpio_list} list of pins`, device);
	}

	// The pin is a stored node: its number is a real field, and the user may change it.
	const pin_ruleset = load_resolved_ruleset(list.include);
	if (!pin_ruleset.ok) {
		return pin_ruleset;
	}
	const pin = unique_name(workfile, list.include);
	const added = add_symbol(workfile, pin, pin_ruleset.value);
	if (!added.ok) {
		return added;
	}

	const port_property = pin_ruleset.value._t === "RulesetStruct"
		? pin_ruleset.value.properties.find(property => property.name === binding.pin_port)
		: undefined;
	if (port_property?._t !== "IncludeProperty" || port_property.include === undefined) {
		return error(`${list.include} has no ${binding.pin_port} port reference`, list.include);
	}

	// The port is the handle wrapping the BSP's own port config - hidden, shared by every
	// pin on that port.
	const port_handle = hidden_candidates(port_property.include, externs).find(candidate => candidate.name === wrapper_name(resolved.port_extern ?? ""));
	if (port_handle === undefined) {
		return error(`No ${port_property.include} handle wraps ${resolved.port_extern}`, resolved.port_extern);
	}
	const port = materialize_hidden(workfile, port_handle, externs);
	if (!port.ok) {
		return port;
	}

	const writes: [string, string, unknown][] = [
		[pin, binding.pin_number, resolved.gpio.number],
		[pin, binding.pin_port, port.value],
		[device, binding.gpio_list, pin],
		...(list.count === undefined ? [] : [[device, list.count, 1] as [string, string, unknown]]),
	];
	for (const [node, property, value] of writes) {
		const set = set_owned(workfile, node, property, value);
		if (!set.ok) {
			return set;
		}
	}

	return ok({
		pin,
		filled: [
			filled_value(workfile, pin, binding.pin_number, resolved.gpio.number, "only value"),
			...(list.count === undefined ? [] : [filled_value(workfile, device, list.count, 1, "only value")]),
		],
		linked: [
			{ node: pin, property: binding.pin_port, target: port.value, symbol: port_property.include, created: true, hidden: true },
			{ node: device, property: binding.gpio_list, target: pin, symbol: list.include, created: true, hidden: false },
		],
	});
}

// --- Where it stopped ---------------------------------------------------------------------

/** Every node this run created, linked from, or gave a chip-select. */
function touched_nodes(report: BootstrapReport): Set<string> {
	return new Set([
		...report.linked.flatMap(link => [link.node, link.target]),
		...report.chip_selects.map(decision => decision.device),
	]);
}

/**
 * The wiring of every bus device this run touched. Untouched devices are left out, so a run
 * that changes nothing reports nothing - their wiring was reported when it was settled.
 */
function wiring_of(workfile: Workfile, touched: Set<string>): BusWiring[] {
	if (workfile.board === undefined) {
		return [];
	}

	const wiring: BusWiring[] = [];
	for (const { device, driver, interface: interface_ } of parts_on_bus(workfile)) {
		if (!touched.has(device)) {
			continue;
		}
		const part = find_eval_board(driver);
		if (!part.ok) {
			continue;
		}
		const binding = get_registry();
		const taken = binding.ok && binding.value.chip_select !== undefined
			? taken_chip_selects(workfile, device, binding.value.chip_select)
			: undefined;
		const resolved = resolve_bus(part.value, workfile.board, interface_, [], taken);
		if (!resolved.ok) {
			continue;
		}

		const problems = [...resolved.value.problems];
		const chip_select = resolved.value.chip_select;
		const options = chip_select?.kind === "unwired"
			? chip_select.options.map(pin => ({ at: pin.at, ...(pin.gpio === undefined ? {} : { gpio: pin.gpio }) }))
			: [];
		if (chip_select?.kind === "unwired") {
			problems.push(`chip-select: ${chip_select.reason}`);
		}
		// Nothing landed and nothing went wrong: the part has no pins for this bus at all,
		// which is a board that cannot be used this way (a SPI-only Pmod set to I2C).
		if (resolved.value.connections.length === 0 && problems.length === 0) {
			problems.push(`${part.value.name} declares no ${interface_} pins, so it cannot be wired over ${interface_}`);
		}

		wiring.push({
			device,
			part: part.value.name,
			interface: interface_,
			...(resolved.value.peripheral === undefined ? {} : { peripheral: resolved.value.peripheral }),
			connections: resolved.value.connections,
			problems,
			...(options.length === 0 ? {} : { chip_select_options: options }),
		});
	}
	return wiring;
}

/** An option by the name `update` takes. */
function option_name(option: Option): string {
	switch (option.kind) {
		case "existing": {
			return option.name;
		}
		case "hidden": {
			return option.candidate.name;
		}
		case "create": {
			return option.symbol;
		}
	}
}

/**
 * Every required reference left unset because it is a choice: more than one option, a node
 * the user holds, or nothing at all that provides it. Hidden nodes are skipped - they are
 * board and driver resources, filled from what they wrap. A requirement from `$any_of` is
 * left to the chip-select, which the wiring reports on.
 */
function open_choices(workfile: Workfile, externs: ExternIndex): OpenChoice[] {
	const graph = create_connections_graph(workfile);
	const choices: OpenChoice[] = [];

	for (const name of Object.keys(workfile.symbols).sort()) {
		const node: Ruleset | undefined = workfile.symbols[name];
		if ((node?._t !== "RulesetStruct" && node?._t !== "RulesetDescriptor") || is_hidden(workfile, name)) {
			continue;
		}

		const collected = collect_child_overrides(name, workfile, graph);
		for (const property of node.properties) {
			if (property.value !== undefined || property.cleared === true || property.readonly === true) {
				continue;
			}
			const { effective, required_reason, selected_member } = apply_overrides(property, collected, name, workfile);
			if (effective.disabled === true || required_reason !== undefined) {
				continue;
			}
			const open = open_reference(workfile, externs, name, effective, selected_member);
			if (open === undefined || the_only(open.options) !== undefined) {
				continue;
			}
			choices.push({
				node: name,
				property: property.name,
				...(open.member === undefined ? {} : { member: open.member }),
				options: open.options.map(option => option_name(option)),
			});
		}
	}
	return choices;
}

// --- Applying a step ---------------------------------------------------------------------

/** Write a value as bootstrap's own: it is listed in the node's "$auto" until the user edits it. */
function set_owned(workfile: Workfile, node: string, property: string, value: unknown): Result<void> {
	const set = set_value(workfile, node, property, value);
	return set.ok ? mark_auto(workfile, node, property) : set;
}

/** A filled value, with the field's number format so it can be shown as the schema writes it. */
function filled_value(workfile: Workfile, node: string, property: string, value: unknown, from: FillSource): FilledValue {
	const ruleset = workfile.symbols[node];
	const field = ruleset?._t === "RulesetStruct" || ruleset?._t === "RulesetDescriptor"
		? ruleset.properties.find(candidate => candidate.name === property)
		: undefined;
	const format = field?._t === "NumberProperty" ? field.format : undefined;
	return { node, property, value, from, ...(format === undefined ? {} : { format }) };
}

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
function realize(workfile: Workfile, option: Option, externs: ExternIndex): Result<{ name: string, symbol: string, created: boolean, hidden: boolean }> {
	switch (option.kind) {
		case "existing": {
			const node = workfile.symbols[option.name];
			return ok({ name: option.name, symbol: node?.$symbol ?? option.name, created: false, hidden: is_hidden(workfile, option.name) });
		}
		case "hidden": {
			const name = materialize_hidden(workfile, option.candidate, externs);
			return name.ok ? ok({ name: name.value, symbol: option.candidate.symbol, created: true, hidden: true }) : name;
		}
		case "create": {
			// A fresh copy every time: add_symbol stores the ruleset by reference and values
			// are written onto it, so a shared instance would let one node's values appear on
			// another.
			const loaded = load_resolved_ruleset_for_board(option.symbol, workfile.board);
			if (!loaded.ok) {
				return loaded;
			}
			const name = unique_name(workfile, option.symbol);
			const added = add_symbol(workfile, name, loaded.value);
			return added.ok ? ok({ name, symbol: option.symbol, created: true, hidden: false }) : added;
		}
	}
}

/**
 * Pin a driver root to the driver the user named (`add ad74413r`): create the root's config
 * and the driver's own init_param - by name, `<driver>_init_param` - and link them, both as
 * bootstrap's. The generic handle (capi_adc) says nothing about which part it is; this is
 * where that fact enters, so nothing below it has to be guessed.
 *
 * A driver with no `<driver>_init_param` is left unpinned: bootstrap then lists its options.
 * `chip` names an existing init_param to link instead of creating one: the second side of one
 * chip (`add ad74413r --as adc,dac` gives capi_adc and capi_dac the same ad74413r_init_param).
 */
export function pin_driver(workfile: Workfile, root: string, driver: string, chip?: string): Result<void> {
	const node = workfile.symbols[root];
	if (node?._t !== "RulesetDescriptor") {
		return error(`'${root}' is not a handle to pin a driver to`, root);
	}
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}
	const module = registry.value.modules.find(candidate => candidate.type === "driver" && candidate.name === driver);
	if (module === undefined) {
		return error(`No configured driver is called '${driver}'`, driver);
	}

	// The root's config: the struct its $init_param takes.
	const config_type = node.properties[0].include;
	if (config_type === undefined) {
		return ok();
	}
	let config = typeof node.properties[0].value === "string" ? node.properties[0].value : undefined;
	if (config === undefined) {
		const loaded = load_resolved_ruleset_for_board(config_type, workfile.board);
		if (!loaded.ok) {
			return loaded;
		}
		config = unique_name(workfile, config_type);
		const added = add_symbol(workfile, config, loaded.value);
		if (!added.ok) {
			return added;
		}
		const linked = set_owned(workfile, root, "$init_param", config);
		if (!linked.ok) {
			return linked;
		}
	}

	// The driver's own init_param, for each driver-backed init_param field it provides for.
	const config_node = workfile.symbols[config];
	const own_config = `${driver}_init_param`;
	const entry = resolve_entry(own_config);
	if (config_node?._t !== "RulesetStruct" || !entry.ok || entry.value.module.path !== module.path || entry.value.$type !== RulesetType.RT_STRUCT) {
		return ok();
	}
	for (const property of config_node.properties) {
		if (property._t !== "DriverInitParameterProperty" || property.value !== undefined
			|| module.provides_interfaces?.includes(property.interface) !== true) {
			continue;
		}
		let name = chip;
		if (name === undefined) {
			const loaded = load_resolved_ruleset_for_board(own_config, workfile.board);
			if (!loaded.ok) {
				return loaded;
			}
			name = unique_name(workfile, own_config);
			const added = add_symbol(workfile, name, loaded.value);
			if (!added.ok) {
				return added;
			}
		} else if (workfile.symbols[name]?.$symbol !== own_config) {
			return error(`'${name}' is not a ${own_config} to share`, name);
		}
		const linked = set_owned(workfile, config, property.name, name);
		if (!linked.ok) {
			return linked;
		}
	}
	return ok();
}

/**
 * Fill in everything that leaves no room for choice, in place, and report what was done.
 *
 * Safe to run any number of times: a second run on the result changes nothing, because
 * every step it could take was already taken.
 */
export function bootstrap(workfile: Workfile, options: BootstrapOptions = {}): Result<BootstrapReport> {
	const externs = build_extern_index(workfile.board);
	if (!externs.ok) {
		return externs;
	}

	// A workfile that was just loaded may reference hidden nodes it does not hold yet.
	const rebuilt = materialize_referenced_hidden(workfile);
	if (!rebuilt.ok) {
		return rebuilt;
	}

	const registry = get_registry();
	const binding = registry.ok ? registry.value.chip_select : undefined;
	const report: BootstrapReport = { revised: [], filled: [], linked: [], chip_selects: [], wiring: [], choices: [], deleted: [], dangling: [] };

	const wiring = wiring_fields(binding);
	// Every node referenced at some point in this command: the ones that can lose their last
	// reference. A node never referenced (a root, a node the user just added) is never dropped.
	const watched = new Set([...options.referenced_before ?? [], ...referenced_nodes(workfile)]);

	for (let steps = 0; steps < STEP_CAP; steps++) {
		// What bootstrap already owns is brought in line first, then what is no longer used
		// goes, so every fill and link after is judged against the workfile that remains.
		const step = revise_step(workfile, wiring) ?? drop_step(workfile, watched) ?? next_step(workfile, externs.value);
		if (step === undefined) {
			// A node that went is reported once, as deleted, not also value by value.
			report.revised = report.revised.filter(revision => !report.deleted.includes(revision.node));
			report.dangling = [...watched]
				.filter(name => name in workfile.symbols && !is_hidden(workfile, name) && !referenced_nodes(workfile).has(name))
				.sort();
			report.wiring = wiring_of(workfile, touched_nodes(report));
			report.choices = open_choices(workfile, externs.value);
			return ok(report);
		}

		switch (step.kind) {
			case "drop": {
				const hidden = is_hidden(workfile, step.node);
				const removed = remove_symbol(workfile, step.node);
				if (!removed.ok) {
					return removed;
				}
				// A hidden node is not the user's to hear about: it was never stored.
				if (!hidden) {
					report.deleted.push(step.node);
				}
				break;
			}
			case "revise": {
				// No value means nothing fills it now: it goes, and is no longer bootstrap's.
				const set = step.value === undefined
					? set_value(workfile, step.node, step.property)
					: set_owned(workfile, step.node, step.property, step.value);
				if (!set.ok) {
					return set;
				}
				const { format } = filled_value(workfile, step.node, step.property, step.value, "default");
				report.revised.push({
					node: step.node,
					property: step.property,
					previous: step.previous,
					...(step.value === undefined ? {} : { value: step.value }),
					...(format === undefined ? {} : { format }),
				});
				break;
			}
			case "fill": {
				const set = set_owned(workfile, step.node, step.property, step.value);
				if (!set.ok) {
					return set;
				}
				report.filled.push(filled_value(workfile, step.node, step.property, step.value, step.from));
				break;
			}
			case "link": {
				const target = realize(workfile, step.option, externs.value);
				if (!target.ok) {
					return target;
				}
				const value = step.member === undefined ? target.value.name : { [step.member]: target.value.name };
				const set = set_owned(workfile, step.node, step.property, value);
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
					hidden: target.value.hidden,
				});
				break;
			}
			case "chip_select": {
				if (binding === undefined) {
					return error("A chip-select step ran without a chip_select binding. That is a bug.");
				}
				const applied = apply_chip_select(workfile, externs.value, step.device, step.resolved, binding);
				if (!applied.ok) {
					return applied;
				}
				report.filled.push(...applied.value.filled);
				report.linked.push(...applied.value.linked);
				report.chip_selects.push({
					device: step.device,
					part: step.part,
					chip_select: step.resolved,
					...(applied.value.pin === undefined ? {} : { pin: applied.value.pin }),
				});
				break;
			}
		}

		for (const name of referenced_nodes(workfile)) {
			watched.add(name);
		}
	}

	return error(
		`Bootstrap took more than ${String(STEP_CAP)} steps without settling. That is a bug: some step is not making progress.`
	);
}
