import { parse as parse_yaml_string } from "yaml";
import {
    BoardBus,
    BoardChipSelect,
    BoardDescription,
    BoardSignal,
    BoardSlot,
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

    return {
        name,
        kind: kind as SignalKind,
        gpio: int_at(map.get("gpio"), `${where}.gpio`),
        ...(reg === undefined ? {} : { reg }),
        connected: optional(map, "connected", bool_at, where) ?? true,
        ...(active === undefined ? {} : { active }),
        open_drain: optional(map, "open_drain", bool_at, where) ?? false,
    };
}

function parse_bus(name: string, value: unknown, where: string): BoardBus {
    const map = map_at(value, where);
    known_keys(map, BUS_KEYS, where);

    const cs_map = optional(map, "chip_selects", map_at, where);
    const seen_regs = new Set<number>();
    const chip_selects: BoardChipSelect[] = [];
    for (const [key, entry] of cs_map ?? []) {
        const entry_where = `${where}.chip_selects.${String(key)}`;
        const reg = key_as_int(key, entry_where);
        if (seen_regs.has(reg)) { fail(entry_where, `duplicate key ${reg}`); }
        seen_regs.add(reg);
        const cs = map_at(entry, entry_where);
        known_keys(cs, CS_KEYS, entry_where);
        const users = cs.get("user");
        chip_selects.push({
            reg,
            gpio: int_at(cs.get("gpio"), `${entry_where}.gpio`),
            users: Array.isArray(users)
                ? users.map((user: unknown, index: number) => string_at(user, `${entry_where}.user[${index}]`))
                : [string_at(users, `${entry_where}.user`)],
        });
    }
    chip_selects.sort((a, b) => a.reg - b.reg);

    const ra_map = optional(map, "reserved_addresses", map_at, where);
    const reserved_addresses: { address: number; description: string }[] = [];
    for (const [key, description] of ra_map ?? []) {
        reserved_addresses.push({
            address: key_as_int(key, `${where}.reserved_addresses`),
            description: string_at(description, `${where}.reserved_addresses.${String(key)}`),
        });
    }

    return { name, node: label_at(map.get("node"), `${where}.node`), chip_selects, reserved_addresses };
}

function parse_slot(id: string, value: unknown, where: string, buses: BoardBus[]): BoardSlot {
    const map = map_at(value, where);
    known_keys(map, SLOT_KEYS, where);

    const bus_name = (key: string): string | undefined => {
        const label = optional(map, key, label_at, where);
        if (label === undefined) { return; }
        const bus = buses.find(b => b.node === label);
        if (bus === undefined) { fail(`${where}.${key}`, `${label} is not the node of any entry in buses`); }
        return bus.name;
    };

    const bus = bus_name("bus");
    if (bus === undefined) { fail(`${where}.bus`, "is required"); }
    const alt_bus = bus_name("alt_bus");
    const selected_by = optional(map, "selected_by", string_at, where);
    const reg = optional(map, "reg", int_at, where);

    const signals_map = optional(map, "signals", map_at, where);
    const signals: BoardSignal[] = [];
    for (const [name, signal] of signals_map ?? []) {
        const n = String(name);
        signals.push(parse_signal(n, signal, `${where}.signals.${n}`));
    }

    return {
        id,
        bus,
        ...(alt_bus === undefined ? {} : { alt_bus }),
        ...(selected_by === undefined ? {} : { selected_by }),
        ...(reg === undefined ? {} : { reg }),
        signals,
    };
}

const ROOT_KEYS = ["schema_version", "board", "host", "gpio_controller", "buses", "slots", "constraints", "gpio_usage", "free_gpios", "conflicting_overlays"] as const;
const BUS_KEYS = ["node", "chip_selects", "reserved_addresses"] as const;
const CS_KEYS = ["gpio", "user"] as const;
const SLOT_KEYS = ["bus", "alt_bus", "selected_by", "reg", "signals"] as const;
const SIGNAL_KEYS = ["kind", "gpio", "reg", "connected", "active", "open_drain"] as const;

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
    known_keys(root, ROOT_KEYS, "");

    const buses_map = map_at(root.get("buses"), "buses");
    const buses: BoardBus[] = [];
    for (const [name, bus] of buses_map) {
        const n = String(name);
        buses.push(parse_bus(n, bus, `buses.${n}`));
    }

    const slots_map = map_at(root.get("slots"), "slots");
    const slots: BoardSlot[] = [];
    for (const [id, slot] of slots_map) {
        const i = String(id);
        slots.push(parse_slot(i, slot, `slots.${i}`, buses));
    }

    const constraints = root.get("constraints") ?? [];
    if (!Array.isArray(constraints)) { fail("constraints", "expected a list"); }

    const gpio_usage_map = optional(root, "gpio_usage", map_at, "");
    const gpio_usage: Record<string, string> = {};
    for (const [gpio, user] of gpio_usage_map ?? []) {
        gpio_usage[String(gpio)] = string_at(user, `gpio_usage.${String(gpio)}`);
    }

    const free_gpios = root.get("free_gpios") ?? [];
    if (!Array.isArray(free_gpios)) { fail("free_gpios", "expected a list"); }

    const conflicting_overlays_map = optional(root, "conflicting_overlays", map_at, "");
    const conflicting_overlays: Record<string, number[]> = {};
    for (const [overlay, pins] of conflicting_overlays_map ?? []) {
        const o = String(overlay);
        if (!Array.isArray(pins)) { fail(`conflicting_overlays.${o}`, "expected a list"); }
        conflicting_overlays[o] = pins.map((pin: unknown, index: number) => int_at(pin, `conflicting_overlays.${o}[${index}]`));
    }

    const host = optional(root, "host", string_at, "");

    return {
        schema_version: int_at(root.get("schema_version"), "schema_version"),
        board: string_at(root.get("board"), "board"),
        ...(host === undefined ? {} : { host }),
        gpio_controller: label_at(root.get("gpio_controller"), "gpio_controller"),
        buses,
        slots,
        constraints: constraints.map((entry: unknown, index: number) => string_at(entry, `constraints[${index}]`)),
        gpio_usage,
        free_gpios: free_gpios.map((gpio: unknown, index: number) => int_at(gpio, `free_gpios[${index}]`)),
        conflicting_overlays,
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
schema_version: 3
board: TEST-HAT
gpio_controller: "&gpio"
buses:
  spi0:
    node: "&spi0"
    chip_selects:
      1: {gpio: 7, user: b.cs}
      0: {gpio: 8, user: [a.cs, c.cs]}
  i2c1:
    node: "&i2c1"
    reserved_addresses: {0x50: EEPROM}
slots:
  a:
    bus: "&spi0"
    reg: 0
    signals:
      int: {kind: interrupt, gpio: 19}
      cs2: {kind: chip-select, gpio: 20, reg: 2}
  c:
    bus: "&spi0"
    alt_bus: "&i2c1"
    selected_by: SW1
    signals:
      alert: {kind: interrupt, gpio: 4, active: low, open_drain: true, connected: false}
`;

    test("parse_board_description — normalises buses, slots and signals", () => {
        const board = parse_board_description(minimal);
        if (typeof board === "string") { throw new TypeError(board); }

        expect(board.board).toBe("TEST-HAT");
        expect(board.buses.find(b => b.name === "spi0")?.chip_selects).toStrictEqual([
            { reg: 0, gpio: 8, users: ["a.cs", "c.cs"] },
            { reg: 1, gpio: 7, users: ["b.cs"] },
        ]);
        expect(board.buses.find(b => b.name === "i2c1")?.reserved_addresses).toStrictEqual([{ address: 0x50, description: "EEPROM" }]);

        const a = board.slots.find(s => s.id === "a");
        expect(a?.bus).toBe("spi0");
        expect(a?.reg).toBe(0);
        expect(a?.signals).toStrictEqual([
            { name: "int", kind: "interrupt", gpio: 19, connected: true, open_drain: false },
            { name: "cs2", kind: "chip-select", gpio: 20, reg: 2, connected: true, open_drain: false },
        ]);

        const c = board.slots.find(s => s.id === "c");
        expect(c?.alt_bus).toBe("i2c1");
        expect(c?.selected_by).toBe("SW1");
        expect(c?.signals[0]).toStrictEqual({ name: "alert", kind: "interrupt", gpio: 4, connected: false, active: "low", open_drain: true });

        expect(board.constraints).toStrictEqual([]);
    });

    test("parse_board_description — reports the offending field", () => {
        expect(parse_board_description(minimal.replace("kind: interrupt, gpio: 19", "kind: irq, gpio: 19")))
            .toBe(`slots.a.signals.int.kind: expected one of interrupt, reset, chip-select, gpio, got "irq"`);
        expect(parse_board_description(minimal.replace(`bus: "&spi0"\n    reg: 0`, `bus: "&spi9"\n    reg: 0`)))
            .toBe("slots.a.bus: &spi9 is not the node of any entry in buses");
        expect(parse_board_description(minimal.replace("{kind: chip-select, gpio: 20, reg: 2}", "{kind: chip-select, gpio: 20}")))
            .toBe("slots.a.signals.cs2.reg: chip-select signals need a reg");
        expect(parse_board_description(minimal.replace(`gpio_controller: "&gpio"`, `gpio_controller: gpio`)))
            .toBe(`gpio_controller: expected a label reference like "&spi0", got "gpio"`);
        expect(parse_board_description(minimal.replace(`node: "&spi0"`, `node: "&my-bus"`)))
            .toContain(`expected a label reference`);
    });

    test("parse_board_description — rejects non-YAML and non-mapping documents", () => {
        expect(parse_board_description("a: [")).toMatch(/^invalid YAML: /);
        expect(parse_board_description("- 1")).toBe("board file: expected a mapping");
    });

    test("parse_board_description — rejects unknown keys with did-you-mean hint", () => {
        const with_hyphen_cs = minimal.replace("chip_selects:", "chip-selects:");
        expect(parse_board_description(with_hyphen_cs)).toBe(`buses.spi0.chip-selects: unknown key; did you mean "chip_selects"?`);

        const with_hyphen_slot = minimal.replace("alt_bus:", "alt-bus:");
        expect(parse_board_description(with_hyphen_slot)).toBe(`slots.c.alt-bus: unknown key; did you mean "alt_bus"?`);

        const with_unknown_root = minimal + "\nfoo: bar\n";
        expect(parse_board_description(with_unknown_root)).toBe("foo: unknown key");
    });

    test("parse_board_description — YAML merge key inherits signals", () => {
        const with_merge = `
schema_version: 3
board: MERGE-TEST
gpio_controller: "&gpio"
buses:
  spi0:
    node: "&spi0"
slots:
  template: &pmod
    bus: "&spi0"
    signals:
      int: {kind: interrupt, gpio: 19}
  slot_a:
    <<: *pmod
    reg: 0
`;
        const board = parse_board_description(with_merge);
        if (typeof board === "string") { throw new TypeError(board); }
        const slot_a = board.slots.find(s => s.id === "slot_a");
        expect(slot_a?.reg).toBe(0);
        expect(slot_a?.signals).toStrictEqual([
            { name: "int", kind: "interrupt", gpio: 19, connected: true, open_drain: false },
        ]);
    });

    test("parse_board_description — rejects duplicate integer keys in chip_selects", () => {
        const dup = minimal.replace("1: {gpio: 7, user: b.cs}", '"0": {gpio: 7, user: b.cs}');
        expect(parse_board_description(dup)).toContain("duplicate key 0");
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
        const i2c = board.buses.find(b => b.name === "i2c1");
        expect(i2c?.reserved_addresses.map(r => r.address)).toStrictEqual([0x50, 0x10]);
    });
}
