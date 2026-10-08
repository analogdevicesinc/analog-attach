/**
 * How a part is wired to a board, and what that wiring makes each line.
 *
 * Three files meet here, each describing only itself:
 *
 *   eval board module.yml   P1 (pmod_12): pin 1 is spi_cs, pin 4 is spi_sck, ...
 *   board module.yml        J9 (feather_16): pin 5 is P2_0 = {MXC_GPIO2, 0}, ...
 *   board board.yml         bsp_spi1_cfg: sck on J9 pin 11, ..., cs on J9 pin 5
 *
 * A pin on the part LANDS on a pin of the board one of three ways, in this order:
 *
 *   1. a stated wire                 the user said where it goes
 *   2. mating                        both connectors follow the same standard (both
 *                                    `pmod_12`), so pin N goes to pin N
 *   3. the board's own declaration   the board's BSP declares exactly ONE pin for that
 *                                    signal: the only SPI clock on any header, or the
 *                                    chip-select line the board uses by convention
 *
 * 3 is what makes a jumper-wired setup work with nothing stated. It never picks: two
 * declared pins for a signal is a question for the user. And it is never role matching
 * against the pinout - a header pin LABELLED spi_cs is not the board saying "use this
 * one", and on max32655fthr the labelled one (J7 pin 8) is not configured at all.
 *
 * Once a pin has landed, the board's own files say what it is: a GPIO on some port, and/or
 * a signal of some bus. From that the bus a part sits on, and how its chip-select is
 * driven, follow without the user ever naming a GPIO number.
 */

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import type { BusPins, PinReference } from "./bsp";
import { board_bus_pins, board_gpio_ports } from "./bsp";
import { find_board } from "./platforms";
import { get_registry, MODULE_TYPE_EVAL_BOARD } from "./registry";
import type { BoardInfo, ConnectorInfo, GpioIdentity, ModuleInfo, PinInfo } from "./types";

/** A stated connection: a pin on the part's connector to a pin on the board's. */
export interface Wire {
	from: PinReference,
	to: PinReference,
}

/** A bus signal a board pin carries. */
export interface PinSignal {
	peripheral: string,
	kind: string,
	signal: string,
	native_cs?: number,
}

/**
 * Chip-select lines other devices already use, so one is never given to two: GPIO pins by
 * their chip identity (one physical pin, whatever bus it selects for), native lines by the
 * controller they belong to and their bit.
 */
export interface TakenChipSelects {
	gpio: GpioIdentity[],
	native: { peripheral: string, native_cs: number }[],
}

const NOTHING_TAKEN: TakenChipSelects = { gpio: [], native: [] };

/** Whether a board pin is a chip-select line another device already uses. */
function is_taken(pin: BoardPin, taken: TakenChipSelects): boolean {
	const gpio = pin.gpio;
	return (gpio !== undefined && taken.gpio.some(used => used.port === gpio.port && used.number === gpio.number))
		|| pin.signals.some(signal => signal.signal === "cs" && signal.native_cs !== undefined
			&& taken.native.some(used => used.peripheral === signal.peripheral && used.native_cs === signal.native_cs));
}

/** Everything the board's own files say about one of its pins. */
export interface BoardPin {
	at: PinReference,
	pin: PinInfo,
	gpio?: GpioIdentity,
	/** The board.yml GPIO port that drives `gpio.port`, if the BSP configures that port. */
	port_extern?: string,
	signals: PinSignal[],
}

/** How a landing was decided. See the file header for the order. */
export type LandingVia = "wire" | "mating" | "board";

/** Where a part's pin ends up: on a board pin, or nowhere that can be known. */
export type Landing =
	| { kind: "wired", to: PinReference, via: LandingVia }
	| { kind: "unwired", reason: string };

/**
 * One connection between a part pin and a board pin, as decided. The list of these is the
 * wiring instruction for a jumper-wired setup: "connect P1 pin 1 to J9 pin 5".
 */
export interface Connection {
	from: PinReference,
	/** The part pin's role, e.g. spi_cs. */
	role: string,
	to: PinReference,
	via: LandingVia,
}

/** How a SPI device's chip-select is driven. */
export type ChipSelect =
	| { kind: "native", peripheral: string, native_cs: number, at: PinReference }
	| { kind: "gpio", gpio: GpioIdentity, port_extern?: string, at: PinReference }
	| { kind: "unwired", reason: string, options: BoardPin[] };

export interface BusResolution {
	/** The board bus the part's data lines land on, when they agree on one. */
	peripheral?: string,
	/** Set for a SPI bus only. */
	chip_select?: ChipSelect,
	/** Every part pin that landed, and how. */
	connections: Connection[],
	/**
	 * Wiring that does not add up: a clock wired to a pin that carries no clock, data lines
	 * split across two buses. Reported rather than refused, because the wiring is the
	 * user's statement and they are the one who has to fix it.
	 */
	problems: string[],
}

type IdentifiedConnector = ConnectorInfo & { id: string };

function identified(connectors: ConnectorInfo[]): IdentifiedConnector[] {
	return connectors.filter((connector): connector is IdentifiedConnector => connector.id !== undefined);
}

function same_reference(a: PinReference, b: PinReference): boolean {
	return a.connector === b.connector && a.pin === b.pin;
}

function show(reference: PinReference): string {
	return `${reference.connector} pin ${reference.pin}`;
}

/** The eval board carrying `driver`, found by its `implements.driver`. */
export function find_eval_board(driver: string): Result<ModuleInfo> {
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}

	const matches = registry.value.modules.filter(
		module => module.type === MODULE_TYPE_EVAL_BOARD && module.implements_driver === driver
	);
	if (matches.length === 0) {
		return error(`No eval board in the configured roots implements '${driver}'`, driver);
	}
	if (matches.length > 1) {
		// Several boards can carry one part. Which one is on the bench is the user's to say.
		const names = matches.map(module => module.name).sort().join(", ");
		return error(`More than one eval board implements '${driver}': ${names}`, driver);
	}

	return ok(matches[0]);
}

function find_pin(connectors: ConnectorInfo[], at: PinReference, owner: string): Result<{ connector: ConnectorInfo, pin: PinInfo }> {
	const connector = connectors.find(candidate => candidate.id === at.connector);
	if (connector === undefined) {
		const known = connectors.flatMap(candidate => candidate.id === undefined ? [] : [candidate.id]).join(", ");
		return error(`${owner} has no connector '${at.connector}'. Known: ${known || "none with an id"}`, at.connector);
	}

	const pin = connector.pins.find(candidate => candidate.pin === at.pin);
	if (pin === undefined) {
		return error(`${owner} connector ${at.connector} has no pin '${at.pin}'`, at.pin);
	}

	return ok({ connector, pin });
}

/** What one board pin is: its GPIO identity, the port extern driving it, the bus signals on it. */
export function describe_board_pin(board_name: string, at: PinReference): Result<BoardPin> {
	const board = find_board(board_name);
	if (!board.ok) {
		return board;
	}

	const found = find_pin(board.value.connectors, at, `Board '${board_name}'`);
	if (!found.ok) {
		return found;
	}

	const buses = board_bus_pins(board_name);
	if (!buses.ok) {
		return buses;
	}

	const ports = board_gpio_ports(board_name);
	if (!ports.ok) {
		return ports;
	}

	const gpio = found.value.pin.gpio;
	return ok({
		at,
		pin: found.value.pin,
		gpio,
		port_extern: gpio === undefined ? undefined : ports.value.get(gpio.port),
		signals: signals_at(buses.value, at),
	});
}

/** The bus signals declared on one pin: the inverse of board.yml `pins:`. */
function signals_at(buses: BusPins[], at: PinReference): PinSignal[] {
	return buses.flatMap(bus => bus.signals
		.filter(signal => same_reference(signal.at, at))
		.map(signal => ({
			peripheral: bus.peripheral,
			kind: bus.kind,
			signal: signal.signal,
			...(signal.native_cs === undefined ? {} : { native_cs: signal.native_cs }),
		})));
}

/**
 * Where a part's pin lands on the board.
 *
 * A stated wire wins. Without one, the part's connector mates only with a board connector
 * of the same `type`, and only if there is exactly one: two PMOD ports on a board are a
 * choice, not a fact.
 */
export function land(part: ModuleInfo, board: BoardInfo, from: PinReference, wires: Wire[]): Landing {
	const wire = wires.find(candidate => same_reference(candidate.from, from));
	if (wire !== undefined) {
		return { kind: "wired", to: wire.to, via: "wire" };
	}

	const connector = (part.connectors ?? []).find(candidate => candidate.id === from.connector);
	if (connector?.type === undefined) {
		return { kind: "unwired", reason: `${part.name} ${from.connector} declares no connector type` };
	}

	const mates = identified(board.connectors).filter(candidate => candidate.type === connector.type);
	const [mate, ...others] = mates;
	if (mate === undefined) {
		return {
			kind: "unwired",
			reason: `${board.name} has no ${connector.type} connector for ${part.name} ${from.connector} to plug into`,
		};
	}
	if (others.length > 0) {
		const ids = mates.map(candidate => candidate.id).join(", ");
		return { kind: "unwired", reason: `${part.name} ${from.connector} could plug into any of ${ids}; say which` };
	}

	return { kind: "wired", to: { connector: mate.id, pin: from.pin }, via: "mating" };
}

/** The part's pins with a given role, each named by its connector id. */
function part_pins_with_role(part: ModuleInfo, role: string): PinReference[] {
	return identified(part.connectors ?? []).flatMap(connector => connector.pins
		.filter(pin => pin.roles.includes(role))
		.map(pin => ({ connector: connector.id, pin: pin.pin })));
}

/**
 * The pins a board's BSP declares for one signal of one kind of bus, deduplicated - limited
 * to one bus when the part's data lines have already settled which.
 */
function declared_pins(buses: BusPins[], kind: string, signal: string, peripheral?: string): PinReference[] {
	const pins: PinReference[] = [];
	for (const bus of buses) {
		if (bus.kind !== kind || (peripheral !== undefined && bus.peripheral !== peripheral)) {
			continue;
		}
		for (const declared of bus.signals) {
			if (declared.signal === signal && !pins.some(pin => same_reference(pin, declared.at))) {
				pins.push(declared.at);
			}
		}
	}
	return pins;
}

/**
 * Land a part pin, falling back to the board's own declaration when neither a wire nor
 * mating placed it. Only an unambiguous declaration counts: exactly one pin.
 */
function land_or_declared(
	part: ModuleInfo,
	board: BoardInfo,
	from: PinReference,
	wires: Wire[],
	declared: PinReference[],
	what: string,
): Landing {
	const landing = land(part, board, from, wires);
	if (landing.kind === "wired") {
		return landing;
	}

	const [only, ...more] = declared;
	if (only === undefined) {
		return { kind: "unwired", reason: `${landing.reason}, and ${board.name} declares no ${what}, so say where it goes` };
	}
	if (more.length > 0) {
		const listed = declared.map(pin => show(pin)).join(", ");
		return { kind: "unwired", reason: `${board.name} declares ${String(declared.length)} ${what}s (${listed}); say which` };
	}

	return { kind: "wired", to: only, via: "board" };
}

/**
 * Header pins a chip-select could go to, for asking: the chip-select lines the bus
 * declares first (native or GPIO-driven), then every GPIO on a physical header. On-board
 * pins are left out - they are already an LED or a button.
 */
function chip_select_options(board: BoardInfo, buses: BusPins[], peripheral: string | undefined, taken: TakenChipSelects): BoardPin[] {
	const declared = declared_pins(buses, "spi", "cs", peripheral);

	const gpio = identified(board.connectors)
		.filter(connector => connector.type !== undefined)
		.flatMap(connector => connector.pins
			.filter(pin => pin.gpio !== undefined)
			.map(pin => ({ connector: connector.id, pin: pin.pin })));

	const options: BoardPin[] = [];
	for (const at of [...declared, ...gpio]) {
		if (options.some(option => same_reference(option.at, at))) {
			continue;
		}
		const described = describe_board_pin(board.name, at);
		// Not a line already selecting another device, nor one carrying another bus signal,
		// and one that can actually drive it: a native line, or a GPIO on a port the BSP sets up.
		const native = described.ok && described.value.signals.some(signal => signal.native_cs !== undefined);
		if (described.ok && !is_taken(described.value, taken)
			&& described.value.signals.every(signal => signal.signal === "cs")
			&& (native || described.value.port_extern !== undefined)) {
			options.push(described.value);
		}
	}
	return options;
}

/**
 * Which board bus a part's bus lines land on, and - for SPI - how its chip-select is driven.
 *
 * `interface_` is the role prefix: `spi` reads the part's spi_sck/spi_mosi/spi_miso/spi_cs
 * pins, `i2c` its i2c_scl/i2c_sda. Each data line lands on a board pin; the bus is whatever
 * peripheral those pins carry the matching signal of, and they must agree on one.
 */
export function resolve_bus(
	part: ModuleInfo,
	board_name: string,
	interface_: string,
	wires: Wire[] = [],
	taken: TakenChipSelects = NOTHING_TAKEN,
): Result<BusResolution> {
	const board = find_board(board_name);
	if (!board.ok) {
		return board;
	}

	const buses = board_bus_pins(board_name);
	if (!buses.ok) {
		return buses;
	}

	const prefix = `${interface_}_`;
	const problems: string[] = [];
	const connections: Connection[] = [];
	const peripherals = new Set<string>();

	const data_roles = (part.connectors ?? [])
		.flatMap(connector => connector.pins.flatMap(pin => pin.roles))
		.filter(role => role.startsWith(prefix) && role !== `${prefix}cs`);

	for (const role of new Set(data_roles)) {
		const signal = role.slice(prefix.length);
		for (const from of part_pins_with_role(part, role)) {
			const declared = declared_pins(buses.value, interface_, signal);
			const landing = land_or_declared(part, board.value, from, wires, declared, `${interface_} ${signal} pin`);
			if (landing.kind === "unwired") {
				problems.push(`${part.name} ${show(from)} (${signal}): ${landing.reason}`);
				continue;
			}
			connections.push({ from, role, to: landing.to, via: landing.via });

			const pin = describe_board_pin(board_name, landing.to);
			if (!pin.ok) {
				return pin;
			}

			const carriers = pin.value.signals.filter(candidate => candidate.signal === signal && candidate.kind === interface_);
			if (carriers.length === 0) {
				problems.push(`${part.name} ${show(from)} (${signal}) lands on ${board_name} ${show(landing.to)}, which carries no ${interface_} ${signal}`);
				continue;
			}
			for (const carrier of carriers) {
				peripherals.add(carrier.peripheral);
			}
		}
	}

	if (peripherals.size > 1) {
		problems.push(`${part.name}'s ${interface_} lines land on more than one bus: ${[...peripherals].sort().join(", ")}`);
	}
	const peripheral = peripherals.size === 1 ? [...peripherals][0] : undefined;

	if (interface_ !== "spi") {
		return ok({ peripheral, connections, problems });
	}

	const chip_select = resolve_chip_select(part, board.value, buses.value, peripheral, wires, connections, problems, taken);
	if (!chip_select.ok) {
		return chip_select;
	}

	return ok({ peripheral, chip_select: chip_select.value, connections, problems });
}

function resolve_chip_select(
	part: ModuleInfo,
	board: BoardInfo,
	buses: BusPins[],
	peripheral: string | undefined,
	wires: Wire[],
	connections: Connection[],
	problems: string[],
	taken: TakenChipSelects,
): Result<ChipSelect> {
	const [from, ...extra_cs] = part_pins_with_role(part, "spi_cs");
	if (from === undefined) {
		return ok({ kind: "unwired", reason: `${part.name} declares no spi_cs pin`, options: [] });
	}
	if (extra_cs.length > 0) {
		// A part with two chip-select lines is not one SPI device. Not modelled yet.
		problems.push(`${part.name} has ${String(extra_cs.length + 1)} spi_cs pins; only ${show(from)} is resolved`);
	}

	const options = (): BoardPin[] => chip_select_options(board, buses, peripheral, taken);

	// A declared line another device already uses is not one to offer.
	const declared_all = declared_pins(buses, "spi", "cs", peripheral);
	const declared = declared_all.filter(at => {
		const described = describe_board_pin(board.name, at);
		return !described.ok || !is_taken(described.value, taken);
	});
	const landing = land_or_declared(part, board, from, wires, declared, "chip-select line");
	if (landing.kind === "unwired") {
		const reason = declared.length === 0 && declared_all.length > 0 && land(part, board, from, wires).kind === "unwired"
			? `every chip-select line ${board.name} declares (${declared_all.map(at => show(at)).join(", ")}) is already used by another device`
			: landing.reason;
		return ok({ kind: "unwired", reason, options: options() });
	}

	const pin = describe_board_pin(board.name, landing.to);
	if (!pin.ok) {
		return pin;
	}
	// Mating or a stated wire put it on one fixed pin; if that pin already selects another
	// device, the two would answer together.
	if (is_taken(pin.value, taken)) {
		return ok({ kind: "unwired", reason: `${part.name} ${show(from)} (cs) lands on ${board.name} ${show(landing.to)}, which is already used by another device`, options: options() });
	}
	connections.push({ from, role: "spi_cs", to: landing.to, via: landing.via });

	// A native chip-select of the very bus the data lines landed on needs no GPIO at all.
	const native = pin.value.signals.find(signal => signal.signal === "cs"
		&& signal.native_cs !== undefined
		&& (peripheral === undefined || signal.peripheral === peripheral));
	if (native?.native_cs !== undefined) {
		return ok({ kind: "native", peripheral: native.peripheral, native_cs: native.native_cs, at: landing.to });
	}

	if (pin.value.gpio !== undefined) {
		if (pin.value.port_extern === undefined) {
			problems.push(`${board.name} ${show(landing.to)} is ${pin.value.gpio.port} pin ${String(pin.value.gpio.number)}, but the board's BSP configures no GPIO port for ${pin.value.gpio.port}`);
		}
		return ok({ kind: "gpio", gpio: pin.value.gpio, port_extern: pin.value.port_extern, at: landing.to });
	}

	problems.push(`${part.name} ${show(from)} (cs) lands on ${board.name} ${show(landing.to)}, which is neither a native chip-select nor a GPIO`);
	return ok({ kind: "unwired", reason: "the chip-select is wired to a pin that cannot drive it", options: options() });
}
