import { parse as parse_yaml_string } from "yaml";
import {
    BoardBus,
    BoardDescription,
    BoardSignal,
    BoardSlot,
    BUS_TYPES,
    BusType,
    SIGNAL_KINDS,
    SignalKind,
} from "./types.js";

type YamlMap = Map<unknown, unknown>;

// Thrown internally with a path-qualified message; converted to the returned
// error string at the parse_board_description boundary.
class BoardSchemaError extends Error { }

function fail(where: string, message: string): never {
    throw new BoardSchemaError(`${where}: ${message}`);
}

function is_map(value: unknown): value is YamlMap {
    return value instanceof Map;
}

function map_at(value: unknown, where: string): YamlMap {
    if (!is_map(value)) { fail(where, "expected a mapping"); }
    return value;
}

function string_at(value: unknown, where: string): string {
    if (typeof value !== "string" || value.length === 0) { fail(where, "expected a non-empty string"); }
    return value;
}

function int_at(value: unknown, where: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) { fail(where, "expected a non-negative integer"); }
    return value;
}

function bool_at(value: unknown, where: string): boolean {
    if (typeof value !== "boolean") { fail(where, "expected true or false"); }
    return value;
}

function label_at(value: unknown, where: string): string {
    const label = string_at(value, where);
    if (!/^&[A-Za-z_]\w*$/.test(label)) { fail(where, `expected a label reference like "&spi0", got "${label}"`); }
    return label;
}

function optional<T>(map: YamlMap, key: string, read: (value: unknown, where: string) => T, where: string): T | undefined {
    const v = map.get(key);
    return v === undefined ? undefined : read(v, where === "" ? key : `${where}.${key}`);
}

function key_as_int(key: unknown, where: string): number {
    if (typeof key === "number" && Number.isInteger(key) && key >= 0) { return key; }
    if (typeof key === "string" && /^\d+$/.test(key)) { return Number(key); }
    fail(where, `expected an integer key, got "${String(key)}"`);
}

function parse_signal(name: string, value: unknown, where: string): BoardSignal {
    const map = map_at(value, where);
    known_keys(map, SIGNAL_KEYS, where);
    const kind = string_at(map.get("kind"), `${where}.kind`);
    if (!(SIGNAL_KINDS as readonly string[]).includes(kind)) {
        fail(`${where}.kind`, `expected one of ${SIGNAL_KINDS.join(", ")}, got "${kind}"`);
    }
    const active = optional(map, "active", string_at, where);
    if (active !== undefined && active !== "high" && active !== "low") {
        fail(`${where}.active`, `expected high or low, got "${active}"`);
    }
    const reg = optional(map, "reg", int_at, where);
    if (kind === "chip-select" && reg === undefined) { fail(`${where}.reg`, "chip-select signals need a reg"); }
    if (kind !== "chip-select" && reg !== undefined) { fail(`${where}.reg`, "only chip-select signals have a reg"); }
    const jumper = optional(map, "jumper", string_at, where);

    return {
        name,
        kind: kind as SignalKind,
        gpio: int_at(map.get("gpio"), `${where}.gpio`),
        ...(reg === undefined ? {} : { reg }),
        connected: optional(map, "connected", bool_at, where) ?? true,
        ...(jumper === undefined ? {} : { jumper }),
        ...(active === undefined ? {} : { active }),
        open_drain: optional(map, "open_drain", bool_at, where) ?? false,
    };
}

function parse_bus(name: string, value: unknown, where: string): BoardBus {
    const map = map_at(value, where);
    known_keys(map, BUS_KEYS, where);

    const type = string_at(map.get("type"), `${where}.type`);
    if (!(BUS_TYPES as readonly string[]).includes(type)) {
        fail(`${where}.type`, `expected one of ${BUS_TYPES.join(", ")}, got "${type}"`);
    }

    const node = optional(map, "node", label_at, where) ?? label_at(`&${name}`, `${where} (key used as the node label; set node to override)`);

    const pins: { name: string; gpio: number }[] = [];
    for (const [pin, gpio] of optional(map, "pins", map_at, where) ?? []) {
        pins.push({ name: String(pin), gpio: int_at(gpio, `${where}.pins.${String(pin)}`) });
    }

    const reserved_addresses: { address: number; description: string }[] = [];
    for (const [key, description] of optional(map, "reserved_addresses", map_at, where) ?? []) {
        const entry_where = `${where}.reserved_addresses.${String(key)}`;
        const address = key_as_int(key, entry_where);
        if (reserved_addresses.some(r => r.address === address)) { fail(entry_where, `duplicate key ${address}`); }
        reserved_addresses.push({ address, description: string_at(description, entry_where) });
    }

    return { name, node, type: type as BusType, pins, reserved_addresses };
}

function parse_slot(id: string, value: unknown, where: string, buses: BoardBus[]): BoardSlot {
    const map = map_at(value, where);
    known_keys(map, SLOT_KEYS, where);

    const bus_value = map.get("bus");
    if (bus_value === undefined) { fail(`${where}.bus`, "is required"); }
    const bus_names = Array.isArray(bus_value)
        ? bus_value.map((entry: unknown, index: number) => string_at(entry, `${where}.bus[${index}]`))
        : [string_at(bus_value, `${where}.bus`)];
    if (bus_names.length === 0) { fail(`${where}.bus`, "expected at least one bus"); }
    for (const [index, bus_name] of bus_names.entries()) {
        const bus_where = Array.isArray(bus_value) ? `${where}.bus[${index}]` : `${where}.bus`;
        if (!buses.some(b => b.name === bus_name)) { fail(bus_where, `${bus_name} is not a key in buses`); }
        if (bus_names.indexOf(bus_name) !== index) { fail(bus_where, `duplicate bus ${bus_name}`); }
    }
    const selected_by = optional(map, "selected_by", string_at, where);
    const onboard = optional(map, "onboard", label_at, where);

    const signals: BoardSignal[] = [];
    for (const [name, signal] of optional(map, "signals", map_at, where) ?? []) {
        const n = String(name);
        signals.push(parse_signal(n, signal, `${where}.signals.${n}`));
    }

    const spi_buses = bus_names.filter(name => buses.find(b => b.name === name)?.type === "spi");
    const chip_select = signals.find(signal => signal.kind === "chip-select");
    if (chip_select !== undefined && spi_buses.length !== 1) {
        fail(`${where}.signals.${chip_select.name}`, spi_buses.length === 0
            ? "chip-select signals need an spi bus in the slot's bus"
            : `chip-select signals are ambiguous: the slot sits on several spi buses (${spi_buses.join(", ")})`);
    }

    return {
        id,
        buses: bus_names,
        ...(selected_by === undefined ? {} : { selected_by }),
        ...(onboard === undefined ? {} : { onboard }),
        signals,
    };
}

// Checks across slots and buses that no single entry can see.
function check_wiring(buses: BoardBus[], slots: BoardSlot[]): void {
    const bus_pins = new Map(buses.flatMap(bus => bus.pins.map(pin => [pin.gpio, `${bus.name}.${pin.name}`] as const)));
    // "<spi bus> <reg>" → the chip-select signals seen with it so far.
    const chip_selects = new Map<string, { gpio: number; owner: string; connected: boolean }[]>();
    for (const slot of slots) {
        const spi_bus = slot.buses.find(name => buses.find(b => b.name === name)?.type === "spi");
        for (const signal of slot.signals) {
            const where = `slots.${slot.id}.signals.${signal.name}`;
            const pin = bus_pins.get(signal.gpio);
            if (pin !== undefined) { fail(`${where}.gpio`, `GPIO${signal.gpio} is bus pin ${pin}`); }
            if (signal.kind !== "chip-select") { continue; }
            const key = `${spi_bus} ${signal.reg}`;
            const seen = chip_selects.get(key) ?? [];
            // A jumper alternative (unconnected) may route the same reg to another GPIO;
            // connected lines for one reg must agree.
            const clash = signal.connected ? seen.find(s => s.connected && s.gpio !== signal.gpio) : undefined;
            if (clash !== undefined) { fail(`${where}.gpio`, `${spi_bus} reg ${signal.reg} is GPIO${clash.gpio} in ${clash.owner}`); }
            const twice = seen.find(s => s.gpio === signal.gpio && s.owner.startsWith(`${slot.id}.`));
            if (twice !== undefined) { fail(`${where}.reg`, `reg ${signal.reg} is already ${twice.owner}`); }
            chip_selects.set(key, [...seen, { gpio: signal.gpio, owner: `${slot.id}.${signal.name}`, connected: signal.connected }]);
        }
    }
}

const SCHEMA_VERSION = 4;
const ROOT_KEYS = ["schema_version", "board", "host", "gpio_controller", "overlay", "buses", "slots", "notes"] as const;
const BUS_KEYS = ["node", "type", "pins", "reserved_addresses"] as const;
const SLOT_KEYS = ["bus", "selected_by", "onboard", "signals"] as const;
const SIGNAL_KEYS = ["kind", "gpio", "reg", "connected", "jumper", "active", "open_drain"] as const;

function known_keys(map: YamlMap, allowed: readonly string[], where: string): void {
    for (const key of map.keys()) {
        const k = String(key);
        if ((allowed as readonly string[]).includes(k)) { continue; }
        const fixed = k.replaceAll("-", "_");
        const hint = fixed !== k && (allowed as readonly string[]).includes(fixed) ? `; did you mean "${fixed}"?` : "";
        fail(where === "" ? k : `${where}.${k}`, `unknown key${hint}`);
    }
}

function parse_description(document: unknown): BoardDescription {
    const root = map_at(document, "board file");
    const schema_version = int_at(root.get("schema_version"), "schema_version");
    if (schema_version !== SCHEMA_VERSION) { fail("schema_version", `expected ${SCHEMA_VERSION}, got ${schema_version}`); }
    known_keys(root, ROOT_KEYS, "");

    const buses: BoardBus[] = [];
    for (const [name, bus] of map_at(root.get("buses"), "buses")) {
        const n = String(name);
        buses.push(parse_bus(n, bus, `buses.${n}`));
    }

    const slots: BoardSlot[] = [];
    for (const [id, slot] of map_at(root.get("slots"), "slots")) {
        const slot_id = String(id);
        slots.push(parse_slot(slot_id, slot, `slots.${slot_id}`, buses));
    }
    check_wiring(buses, slots);

    const notes = root.get("notes") ?? [];
    if (!Array.isArray(notes)) { fail("notes", "expected a list"); }

    const host = optional(root, "host", string_at, "");
    const overlay = optional(root, "overlay", string_at, "");

    return {
        schema_version,
        board: string_at(root.get("board"), "board"),
        ...(host === undefined ? {} : { host }),
        gpio_controller: label_at(root.get("gpio_controller"), "gpio_controller"),
        ...(overlay === undefined ? {} : { overlay }),
        buses,
        slots,
        notes: notes.map((entry: unknown, index: number) => string_at(entry, `notes[${index}]`)),
    };
}

/**
 * Parse a board description from YAML text. Returns the description, or an
 * error string naming the offending field (same convention as
 * `DeviceTree.new_from_string`).
 */
export function parse_board_description(content: string): BoardDescription | string {
    let document: unknown;
    try {
        document = parse_yaml_string(content, { merge: true, mapAsMap: true });
    } catch (error) {
        return `invalid YAML: ${error instanceof Error ? error.message : String(error)}`;
    }

    try {
        return parse_description(document);
    } catch (error) {
        if (error instanceof BoardSchemaError) { return error.message; }
        throw error;
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const minimal = `
schema_version: 4
board: TEST-HAT
gpio_controller: "&gpio"
buses:
  spi0:
    type: spi
    pins: {sclk: 11, mosi: 10}
  i2c1:
    node: "&i2c_arm"
    type: i2c
    reserved_addresses: {0x50: EEPROM}
slots:
  a:
    bus: spi0
    signals:
      cs1: {kind: chip-select, gpio: 8, reg: 0}
      int: {kind: interrupt, gpio: 19}
      cs2: {kind: chip-select, gpio: 20, reg: 2}
  c:
    bus: [spi0, i2c1]
    selected_by: SW1
    signals:
      cs: {kind: chip-select, gpio: 8, reg: 0}
      alert: {kind: interrupt, gpio: 4, active: low, open_drain: true, connected: false, jumper: JP1}
notes:
  - no pull-ups
`;

    test("parse_board_description — normalises buses, slots and signals", () => {
        const board = parse_board_description(minimal);
        if (typeof board === "string") { throw new TypeError(board); }

        expect(board.board).toBe("TEST-HAT");
        expect(board.buses).toStrictEqual([
            { name: "spi0", node: "&spi0", type: "spi", pins: [{ name: "sclk", gpio: 11 }, { name: "mosi", gpio: 10 }], reserved_addresses: [] },
            { name: "i2c1", node: "&i2c_arm", type: "i2c", pins: [], reserved_addresses: [{ address: 0x50, description: "EEPROM" }] },
        ]);

        const a = board.slots.find(s => s.id === "a");
        expect(a?.buses).toStrictEqual(["spi0"]);
        expect(a?.signals).toStrictEqual([
            { name: "cs1", kind: "chip-select", gpio: 8, reg: 0, connected: true, open_drain: false },
            { name: "int", kind: "interrupt", gpio: 19, connected: true, open_drain: false },
            { name: "cs2", kind: "chip-select", gpio: 20, reg: 2, connected: true, open_drain: false },
        ]);

        const c = board.slots.find(s => s.id === "c");
        expect(c?.buses).toStrictEqual(["spi0", "i2c1"]);
        expect(c?.selected_by).toBe("SW1");
        expect(c?.signals[1]).toStrictEqual({ name: "alert", kind: "interrupt", gpio: 4, connected: false, jumper: "JP1", active: "low", open_drain: true });

        expect(board.notes).toStrictEqual(["no pull-ups"]);
    });

    test("parse_board_description — reports the offending field", () => {
        expect(parse_board_description(minimal.replace("kind: interrupt, gpio: 19", "kind: irq, gpio: 19")))
            .toBe(`slots.a.signals.int.kind: expected one of interrupt, reset, chip-select, gpio, got "irq"`);
        expect(parse_board_description(minimal.replace("bus: spi0\n", "bus: spi9\n")))
            .toBe("slots.a.bus: spi9 is not a key in buses");
        expect(parse_board_description(minimal.replace("{kind: chip-select, gpio: 20, reg: 2}", "{kind: chip-select, gpio: 20}")))
            .toBe("slots.a.signals.cs2.reg: chip-select signals need a reg");
        expect(parse_board_description(minimal.replace("{kind: interrupt, gpio: 19}", "{kind: interrupt, gpio: 19, reg: 1}")))
            .toBe("slots.a.signals.int.reg: only chip-select signals have a reg");
        expect(parse_board_description(minimal.replace(`gpio_controller: "&gpio"`, `gpio_controller: gpio`)))
            .toBe(`gpio_controller: expected a label reference like "&spi0", got "gpio"`);
        expect(parse_board_description(minimal.replace(`node: "&i2c_arm"`, `node: "&my-bus"`)))
            .toContain(`expected a label reference`);
        expect(parse_board_description(minimal.replace("type: spi", "type: uart")))
            .toBe(`buses.spi0.type: expected one of spi, i2c, got "uart"`);
        expect(parse_board_description(minimal.replace("schema_version: 4", "schema_version: 3")))
            .toBe("schema_version: expected 4, got 3");
    });

    test("parse_board_description — checks wiring across slots", () => {
        expect(parse_board_description(minimal.replace("cs: {kind: chip-select, gpio: 8, reg: 0}", "cs: {kind: chip-select, gpio: 9, reg: 0}")))
            .toBe("slots.c.signals.cs.gpio: spi0 reg 0 is GPIO8 in a.cs1");
        expect(parse_board_description(minimal.replace("{kind: chip-select, gpio: 20, reg: 2}", "{kind: chip-select, gpio: 8, reg: 0}")))
            .toBe("slots.a.signals.cs2.reg: reg 0 is already a.cs1");
        expect(parse_board_description(minimal.replace("{kind: interrupt, gpio: 19}", "{kind: interrupt, gpio: 11}")))
            .toBe("slots.a.signals.int.gpio: GPIO11 is bus pin spi0.sclk");
        expect(parse_board_description(minimal.replace("bus: [spi0, i2c1]", "bus: i2c1")))
            .toBe("slots.c.signals.cs: chip-select signals need an spi bus in the slot's bus");
    });

    test("parse_board_description — a jumper alternative may route a reg to another GPIO", () => {
        const alternative = minimal.replace("      int: {kind: interrupt, gpio: 19}\n",
            "      int: {kind: interrupt, gpio: 19}\n      cs1_alt: {kind: chip-select, gpio: 27, reg: 0, connected: false, jumper: P11}\n");
        expect(typeof parse_board_description(alternative)).toBe("object");
        expect(parse_board_description(alternative.replace("reg: 0, connected: false, jumper: P11", "reg: 0")))
            .toBe("slots.a.signals.cs1_alt.gpio: spi0 reg 0 is GPIO8 in a.cs1");
    });

    test("parse_board_description — rejects non-YAML and non-mapping documents", () => {
        expect(parse_board_description("a: [")).toMatch(/^invalid YAML: /);
        expect(parse_board_description("- 1")).toBe("board file: expected a mapping");
    });

    test("parse_board_description — rejects unknown keys with did-you-mean hint", () => {
        const with_hyphen_ra = minimal.replace("reserved_addresses:", "reserved-addresses:");
        expect(parse_board_description(with_hyphen_ra)).toBe(`buses.i2c1.reserved-addresses: unknown key; did you mean "reserved_addresses"?`);

        const with_hyphen_slot = minimal.replace("selected_by:", "selected-by:");
        expect(parse_board_description(with_hyphen_slot)).toBe(`slots.c.selected-by: unknown key; did you mean "selected_by"?`);

        const with_unknown_root = minimal + "\nfoo: bar\n";
        expect(parse_board_description(with_unknown_root)).toBe("foo: unknown key");
    });

    test("parse_board_description — board overlay and onboard slots", () => {
        const with_onboard = minimal
            .replace(`gpio_controller: "&gpio"\n`, `gpio_controller: "&gpio"\noverlay: ../overlays/test.dts\n`)
            .replace("notes:", "  adc:\n    bus: i2c1\n    onboard: \"&adc\"\nnotes:");
        const board = parse_board_description(with_onboard);
        if (typeof board === "string") { throw new TypeError(board); }
        expect(board.overlay).toBe("../overlays/test.dts");
        expect(board.slots.find(s => s.id === "adc")).toStrictEqual({ id: "adc", buses: ["i2c1"], onboard: "&adc", signals: [] });
        expect(parse_board_description(with_onboard.replace(`onboard: "&adc"`, "onboard: adc")))
            .toBe(`slots.adc.onboard: expected a label reference like "&spi0", got "adc"`);
    });

    test("parse_board_description — YAML merge key inherits signals", () => {
        const with_merge = `
schema_version: 4
board: MERGE-TEST
gpio_controller: "&gpio"
buses:
  spi0: {type: spi}
slots:
  template: &pmod
    bus: spi0
    signals:
      int: {kind: interrupt, gpio: 19}
  slot_a:
    <<: *pmod
    selected_by: J1
`;
        const board = parse_board_description(with_merge);
        if (typeof board === "string") { throw new TypeError(board); }
        const slot_a = board.slots.find(s => s.id === "slot_a");
        expect(slot_a?.selected_by).toBe("J1");
        expect(slot_a?.signals).toStrictEqual([
            { name: "int", kind: "interrupt", gpio: 19, connected: true, open_drain: false },
        ]);
    });

    test("parse_board_description — rejects duplicate integer keys in reserved_addresses", () => {
        const dup = minimal.replace("reserved_addresses: {0x50: EEPROM}", `reserved_addresses: {0x50: EEPROM, "80": RTC}`);
        expect(parse_board_description(dup)).toContain("duplicate key 80");
    });

    test("parse_board_description — slot ids keep file order", () => {
        const board = parse_board_description(minimal);
        if (typeof board === "string") { throw new TypeError(board); }
        expect(board.slots.map(s => s.id)).toStrictEqual(["a", "c"]);
    });

    test("parse_board_description — reserved_addresses keep file order", () => {
        const multi = minimal.replace(
            "reserved_addresses: {0x50: EEPROM}",
            "reserved_addresses:\n      0x50: EEPROM\n      0x10: RTC"
        );
        const board = parse_board_description(multi);
        if (typeof board === "string") { throw new TypeError(board); }
        const bus = board.buses.find(b => b.name === "i2c1");
        expect(bus?.reserved_addresses.map(r => r.address)).toStrictEqual([0x50, 0x10]);
    });
}
