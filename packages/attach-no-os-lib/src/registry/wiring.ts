/**
 * How a part is wired to a board, and what that wiring makes each line.
 *
 * Three files meet here, each describing only itself:
 *
 *   eval board module.yml   P1 (pmod_12): pin 1 is spi_cs, pin 4 is spi_sck, ...
 *   board module.yml        J9 (feather_16): pin 5 is P2_0 = {MXC_GPIO2, 0}, ...
 *   board board.yml         bsp_spi1_cfg: sck on J9 pin 11, cs on J7 pin 8 (native_cs 0)
 *
 * A pin on the part LANDS on a pin of the board one of two ways. If the two connectors
 * follow the same standard (both `pmod_12`), pin N mates with pin N and nothing has to be
 * said. Otherwise - a PMOD jumper-wired to a Feather header - the wire has to be stated,
 * and is never guessed: matching by role across different standards picks a pin that
 * merely has the right label, which on max32655fthr is the wrong one.
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

/** Everything the board's own files say about one of its pins. */
export interface BoardPin {
	at: PinReference,
	pin: PinInfo,
	gpio?: GpioIdentity,
	/** The board.yml GPIO port that drives `gpio.port`, if the BSP configures that port. */
	port_extern?: string,
	signals: PinSignal[],
}

/** Where a part's pin ends up: on a board pin, or nowhere that can be known. */
export type Landing =
	| { kind: "wired", to: PinReference, via: "wire" | "mating" }
	| { kind: "unwired", reason: string };

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
		return { kind: "unwired", reason: `${part.name} ${from.connector} declares no connector type, so its wiring has to be stated` };
	}

	const mates = identified(board.connectors).filter(candidate => candidate.type === connector.type);
	const [mate, ...others] = mates;
	if (mate === undefined) {
		return {
			kind: "unwired",
			reason: `${board.name} has no ${connector.type} connector for ${part.name} ${from.connector} to plug into, so its wiring has to be stated`,
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
 * Header pins a chip-select could go to, for asking: the bus's own native chip-selects
 * first, then every GPIO on a physical header. On-board pins are left out - they are
 * already an LED or a button.
 */
function chip_select_options(board: BoardInfo, buses: BusPins[], peripheral: string | undefined): BoardPin[] {
	const native = buses
		.filter(bus => peripheral === undefined || bus.peripheral === peripheral)
		.flatMap(bus => bus.signals.filter(signal => signal.signal === "cs"))
		.map(signal => signal.at);

	const gpio = identified(board.connectors)
		.filter(connector => connector.type !== undefined)
		.flatMap(connector => connector.pins
			.filter(pin => pin.gpio !== undefined)
			.map(pin => ({ connector: connector.id, pin: pin.pin })));

	const options: BoardPin[] = [];
	for (const at of [...native, ...gpio]) {
		if (options.some(option => same_reference(option.at, at))) {
			continue;
		}
		const described = describe_board_pin(board.name, at);
		if (described.ok) {
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
	const peripherals = new Set<string>();

	const data_roles = (part.connectors ?? [])
		.flatMap(connector => connector.pins.flatMap(pin => pin.roles))
		.filter(role => role.startsWith(prefix) && role !== `${prefix}cs`);

	for (const role of new Set(data_roles)) {
		const signal = role.slice(prefix.length);
		for (const from of part_pins_with_role(part, role)) {
			const landing = land(part, board.value, from, wires);
			if (landing.kind === "unwired") {
				problems.push(`${part.name} ${show(from)} (${signal}): ${landing.reason}`);
				continue;
			}

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
		return ok({ peripheral, problems });
	}

	const chip_select = resolve_chip_select(part, board.value, buses.value, peripheral, wires, problems);
	if (!chip_select.ok) {
		return chip_select;
	}

	return ok({ peripheral, chip_select: chip_select.value, problems });
}

function resolve_chip_select(
	part: ModuleInfo,
	board: BoardInfo,
	buses: BusPins[],
	peripheral: string | undefined,
	wires: Wire[],
	problems: string[],
): Result<ChipSelect> {
	const [from, ...extra_cs] = part_pins_with_role(part, "spi_cs");
	if (from === undefined) {
		return ok({ kind: "unwired", reason: `${part.name} declares no spi_cs pin`, options: [] });
	}
	if (extra_cs.length > 0) {
		// A part with two chip-select lines is not one SPI device. Not modelled yet.
		problems.push(`${part.name} has ${String(extra_cs.length + 1)} spi_cs pins; only ${show(from)} is resolved`);
	}

	const landing = land(part, board, from, wires);
	if (landing.kind === "unwired") {
		return ok({ kind: "unwired", reason: landing.reason, options: chip_select_options(board, buses, peripheral) });
	}

	const pin = describe_board_pin(board.name, landing.to);
	if (!pin.ok) {
		return pin;
	}

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
	return ok({ kind: "unwired", reason: "the chip-select is wired to a pin that cannot drive it", options: chip_select_options(board, buses, peripheral) });
}
