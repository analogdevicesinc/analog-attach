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
 * Termination: every step sets a value that was unset or adds a node, and nothing is ever
 * unset or removed, so the loop only moves forward. The step cap is a bug detector, not the
 * stopping condition.
 */

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import type { IncludeProperty, NumberFormat, Property, Ruleset } from "../ruleset_parser/types";
import { provided_id, RulesetType } from "../ruleset_parser/types";
import { load_resolved_ruleset, load_resolved_ruleset_for_board } from "../resolver/resolver";
import type { ChipSelectBinding } from "../registry/module_yml";
import { driver_init_parameter_candidates, driver_ops_candidates } from "../registry/drivers";
import { build_extern_index, hidden_candidates, wrapper_name } from "../registry/hidden";
import type { ExternIndex, HiddenCandidate } from "../registry/hidden";
import { get_registry, resolve_entry } from "../registry/registry";
import { find_eval_board, resolve_bus } from "../registry/wiring";
import type { ChipSelect, Connection } from "../registry/wiring";
import { collect_child_overrides, create_connections_graph } from "../validator/connection_graph";
import { apply_overrides } from "../validator/override_resolver";
import { add_symbol, is_hidden, materialize_hidden, materialize_referenced_hidden, set_value } from "../workfile_handler/workfile_handler";
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
	filled: FilledValue[],
	linked: LinkedReference[],
	chip_selects: ChipSelectDecision[],
	/** Wiring for every bus device this run created or connected. */
	wiring: BusWiring[],
	/** Where bootstrap stopped: the required references still open, with their options. */
	choices: OpenChoice[],
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
	| { kind: "existing", name: string, bindable: boolean }
	| { kind: "hidden", candidate: HiddenCandidate }
	| { kind: "create", symbol: string };

function existing_option(workfile: Workfile, name: string, node: Ruleset): Option {
	return { kind: "existing", name, bindable: is_hidden(workfile, name) || node._t === "RulesetExtern" };
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

	for (const [name, node] of Object.entries(workfile.symbols)) {
		if (name !== self && provided_id(node) === type_) {
			options.push(existing_option(workfile, name, node));
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

	if (candidates.length === 0) {
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
			options.push(existing_option(workfile, name, node));
		}
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

/** The one option to take, or none: anything but exactly one option, or a user-held node, is a choice. */
function the_only(options: Option[]): Option | undefined {
	const [only, ...more] = options;
	if (only === undefined || more.length > 0) {
		return undefined;
	}
	if (only.kind === "existing" && !only.bindable) {
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
				? { options: driver_options(workfile, candidates.value.map(entry => entry.$symbol), name) }
				: undefined;
		}
		case "DriverOpsProperty": {
			if (effective.required !== true) {
				return undefined;
			}
			const candidates = driver_ops_candidates(effective.interface);
			return candidates.ok
				? { options: driver_options(workfile, candidates.value.map(entry => entry.$symbol), name) }
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
			if (property._t !== "UnionProperty" || typeof property.value !== "object" || property.value === null) {
				continue;
			}
			for (const target of Object.values(property.value as Record<string, unknown>)) {
				const device = typeof target === "string" ? workfile.symbols[target] : undefined;
				const device_entry = device === undefined ? undefined : resolve_entry(device.$symbol);
				if (typeof target === "string" && device_entry?.ok === true) {
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
		if (has_chip_select(device_node, chip_select) || device_node._t !== "RulesetStruct") {
			continue;
		}

		// Only a part whose eval board is known can be wired; anything else stays a question.
		const part = find_eval_board(driver);
		if (!part.ok) {
			continue;
		}
		const resolved = resolve_bus(part.value, workfile.board, "spi");
		if (!resolved.ok) {
			continue;
		}

		// The bus the part's lines land on decides the controller, where the board alone
		// could not (two SPI buses means two controller handles to choose from).
		const peripheral = resolved.value.peripheral;
		if (peripheral !== undefined) {
			for (const property of device_node.properties) {
				if (property._t !== "IncludeProperty" || property.value !== undefined || property.include === undefined) {
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
		const set = set_value(workfile, device, binding.native_mask, mask);
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
		const set = set_value(workfile, node, property, value);
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
		const resolved = resolve_bus(part.value, workfile.board, interface_);
		if (!resolved.ok) {
			continue;
		}

		const problems = [...resolved.value.problems];
		const chip_select = resolved.value.chip_select;
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
			if (property.value !== undefined || property.readonly === true) {
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
 * Fill in everything that leaves no room for choice, in place, and report what was done.
 *
 * Safe to run any number of times: a second run on the result changes nothing, because
 * every step it could take was already taken.
 */
export function bootstrap(workfile: Workfile): Result<BootstrapReport> {
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
	const report: BootstrapReport = { filled: [], linked: [], chip_selects: [], wiring: [], choices: [] };

	for (let steps = 0; steps < STEP_CAP; steps++) {
		const step = next_step(workfile, externs.value);
		if (step === undefined) {
			report.wiring = wiring_of(workfile, touched_nodes(report));
			report.choices = open_choices(workfile, externs.value);
			return ok(report);
		}

		switch (step.kind) {
			case "fill": {
				const set = set_value(workfile, step.node, step.property, step.value);
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
	}

	return error(
		`Bootstrap took more than ${String(STEP_CAP)} steps without settling. That is a bug: some step is not making progress.`
	);
}
