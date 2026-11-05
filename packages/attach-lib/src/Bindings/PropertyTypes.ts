import * as fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/**
 * What dt-schema calls a property type: the name of the `types.yaml` definition the property is declared with
 * (`uint32-matrix`, `phandle-array`, `string-array`, ...), `flag`, or `address`.
 */
export type PropertyType = string;

/** The type of each property name (`reg`, `clocks`) and name pattern (`-gpios$`) the dt-schema schemas declare. */
export type PropertyTypes = {
    names: Map<string, PropertyType>;
    patterns: { pattern: RegExp, type: PropertyType }[];
    /**
     * For a name declared a `flag` or one other type (`ranges: {oneOf: [flag, uint32-matrix]}`), the other: the type of
     * a value the binding counts, as a flag has no items.
     */
    counted?: Map<string, PropertyType>;
};

export const NO_PROPERTY_TYPES: PropertyTypes = { names: new Map(), patterns: [] };

// dt-schema: `validator.py:type_re`
const TYPE_NAME = /(address|flag|u?int(8|16|32|64)(-(array|matrix))?|string(-array)?|phandle(-array)?)/;

/** The type a property schema is declared with, going by its `$ref` (dt-schema: `validator.py:_extract_prop_type`). */
function declared_type(schema: unknown): PropertyType | undefined {
    if (!is_schema(schema)) { return undefined; }

    const reference = schema["$ref"];
    if (typeof reference === "string") {
        const found = TYPE_NAME.exec(reference);
        if (found !== null) { return found[0]; }
    }

    if (schema["type"] === "boolean") { return "flag"; }

    for (const key of ["allOf", "oneOf", "anyOf"]) {
        const branches = schema[key];
        if (!Array.isArray(branches)) { continue; }

        for (const branch of branches) {
            const type = declared_type(branch);
            if (type !== undefined) { return type; }
        }
    }

    return undefined;
}

/**
 * The type other than `flag` of a schema that is a flag or one other type (reg.yaml's `ranges` and `dma-ranges`: an
 * empty value, or a `uint32-matrix`); undefined for any other schema.
 */
function counted_type(schema: unknown): PropertyType | undefined {
    if (!is_schema(schema)) { return undefined; }

    for (const key of ["oneOf", "anyOf"]) {
        const branches = schema[key];
        if (!Array.isArray(branches)) { continue; }

        const types = new Set(branches.map(branch => declared_type(branch)));
        if (types.size === 2 && types.has("flag") && !types.has(undefined)) {
            return [...types].find(type => type !== "flag");
        }
    }

    return undefined;
}

function* schema_files(directory: string): Generator<string> {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entry_path = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* schema_files(entry_path);
        } else if (entry.name.endsWith(".yaml")) {
            yield entry_path;
        }
    }
}

/** A schema for one node of a given name (`/aliases`, `/chosen`, `/memory`): what it declares is not for every node. */
function is_single_node_schema(schema: Schema): boolean {
    const properties = schema["properties"];
    const nodename = is_schema(properties) ? properties["$nodename"] : undefined;
    return is_schema(nodename) && "const" in nodename;
}

function collect(schema: unknown, types: PropertyTypes): void {
    if (!is_schema(schema) || is_single_node_schema(schema)) { return; }

    for (const [name, property] of Object.entries(is_schema(schema["properties"]) ? schema["properties"] : {})) {
        const type = declared_type(property);
        if (type !== undefined && !types.names.has(name)) { types.names.set(name, type); }

        // Whichever schema gives it: pci-bus-common.yaml's `ranges` is a boolean or an untyped list, reg.yaml's a flag
        // or a `uint32-matrix`
        const counted = counted_type(property);
        if (counted !== undefined && types.names.get(name) === "flag" && !types.counted?.has(name)) { types.counted?.set(name, counted); }
    }

    for (const [pattern, property] of Object.entries(is_schema(schema["patternProperties"]) ? schema["patternProperties"] : {})) {
        const type = declared_type(property);
        if (type === undefined) { continue; }

        try {
            types.patterns.push({ pattern: new RegExp(pattern), type });
        } catch {
            // a pattern only Python's `re` understands
        }
    }

    for (const key of ["allOf", "oneOf", "anyOf"]) {
        const branches = schema[key];
        if (Array.isArray(branches)) {
            for (const branch of branches) { collect(branch, types); }
        }
    }
}

const loaded = new Map<string, PropertyTypes>();

/**
 * The property types dt-schema's own schemas declare (`<dt_schema>/dtschema/schemas`): the properties every
 * node can have, whose bindings give them no type (`reg`, `interrupts`, `clocks`, `#address-cells`). dt-schema
 * collects the types of all schemas by name (`validator.py:extract_types`); the Linux bindings declare theirs
 * in the binding itself, so those are not read here. Read once per directory.
 */
export function load_property_types(dt_schema: string): PropertyTypes {
    const directory = path.join(dt_schema, "dtschema/schemas");
    const cached = loaded.get(directory);
    if (cached !== undefined) { return cached; }

    const types: PropertyTypes = { names: new Map(), patterns: [], counted: new Map() };

    if (fs.existsSync(directory)) {
        for (const file of schema_files(directory)) {
            try {
                collect(parse(fs.readFileSync(file, "utf8")), types);
            } catch {
                // a file that doesn't parse declares nothing
            }
        }
    }

    loaded.set(directory, types);
    return types;
}

type GeneratedTypes = { properties?: Record<string, { type?: string | null }[]> };

const loaded_processed = new Map<string, { modified: number, base: PropertyTypes, types: PropertyTypes }>();

/**
 * The one type a property has in `generated-types`; a name several schemas type differently (`pins`, a `string-array` or
 * a `uint32-array`) has none. A `phandle` and a `phandle-array` are a `phandle-array` (`usb-phy`), as one phandle is a
 * row of one cell. A `flag` and one integer type are the flag (pincfg-node.yaml's `bias-pull-up`, the pull strength in
 * Ohm), as `fixup_one_form` reads a property declared so.
 */
function single_type(entries: { type?: string | null }[]): PropertyType | undefined {
    const types = new Set(entries.map(entry => entry.type).filter((type): type is string => typeof type === "string" && type !== "node"));
    if (types.size === 2 && types.has("phandle") && types.has("phandle-array")) { return "phandle-array"; }
    if (types.size === 2 && types.has("flag") && [...types].some(type => /^u?int(8|16|32|64)$/.test(type))) { return "flag"; }
    return types.size === 1 ? [...types][0] : undefined;
}

/**
 * `base` (the types dt-schema's own schemas declare) and, for the names it doesn't know, the property types of a
 * processed schema (the output of `dt-mk-schema -j`): its `generated-types` and `generated-pattern-types` are what
 * `validator.py:extract_types` makes of every schema the tool was given, the Linux bindings included, so a property
 * a binding leaves untyped gets the type another binding declares for its name (`nvmem-cells`, `mux-controls`).
 * What dt-schema itself declares stays: `resets` is a `phandle-array` there, and a `phandle` in some binding.
 * `base` alone when the file can't be read. Read once per file and modification time.
 */
export function load_processed_property_types(file: string, base: PropertyTypes): PropertyTypes {
    let modified: number;
    try {
        modified = fs.statSync(file).mtimeMs;
    } catch {
        return base;
    }

    const cached = loaded_processed.get(file);
    if (cached?.modified === modified && cached.base === base) { return cached.types; }

    const types: PropertyTypes = { names: new Map(base.names), patterns: [...base.patterns], ...(base.counted === undefined ? {} : { counted: base.counted }) };

    try {
        const processed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, GeneratedTypes | undefined>;

        for (const [name, entries] of Object.entries(processed["generated-types"]?.properties ?? {})) {
            const type = single_type(entries);
            if (type !== undefined && !types.names.has(name)) { types.names.set(name, type); }
        }

        for (const [pattern, entries] of Object.entries(processed["generated-pattern-types"]?.properties ?? {})) {
            const type = single_type(entries);
            if (type === undefined) { continue; }

            try {
                types.patterns.push({ pattern: new RegExp(pattern), type });
            } catch {
                // a pattern only Python's `re` understands
            }
        }
    } catch {
        return base;
    }

    loaded_processed.set(file, { modified, base, types });
    return types;
}

/** The type of the property named `name`, by exact name first, then by pattern. */
export function property_type(types: PropertyTypes, name: string): PropertyType | undefined {
    return types.names.get(name) ?? types.patterns.find(({ pattern }) => pattern.test(name))?.type;
}

/** A type whose value is a list of cell lists (`reg`, `interrupts`, `clocks`): `<1 2>, <3 4>`. A single phandle is one row of one cell. */
export function is_matrix_type(type: PropertyType | undefined): boolean {
    return type === "phandle" || type === "phandle-array" || type === "address" || type?.endsWith("-matrix") === true;
}

/** The numbers a type's cells can take (an `address` is `uint32`s); undefined for the types that aren't numbers. */
export function cell_range(type: PropertyType): { minimum: bigint, maximum: bigint } | undefined {
    const found = /^(u?)int(8|16|32|64)(-|$)/.exec(type === "address" ? "uint32" : type);
    if (found === null) { return undefined; }

    const bits = BigInt(found[2]!);
    return found[1] === "u"
        ? { minimum: 0n, maximum: (1n << bits) - 1n }
        : { minimum: -(1n << (bits - 1n)), maximum: (1n << (bits - 1n)) - 1n };
}

import { tmpdir as _tmpdir } from "node:os";
import { is_schema, Schema } from "./Schema.js";

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;
    const tmpdir = _tmpdir;

    test("the type of a schema is the one its $ref names, as dt-schema reads it", () => {
        expect(declared_type({ $ref: "/schemas/types.yaml#/definitions/uint32-matrix", maxItems: 1 })).toBe("uint32-matrix");
        expect(declared_type({ $ref: "/schemas/types.yaml#/definitions/phandle-array" })).toBe("phandle-array");
        expect(declared_type({ $ref: "#/definitions/string-array" })).toBe("string-array");
        expect(declared_type({ allOf: [{ description: "x" }, { $ref: "/schemas/types.yaml#/definitions/phandle" }] })).toBe("phandle");
        expect(declared_type({ type: "boolean" })).toBe("flag");
        expect(declared_type({ maxItems: 1 })).toBeUndefined();
        expect(declared_type(true)).toBeUndefined();
    });

    test("a name declared a flag or one other type has the other for a value it counts", () => {
        expect(counted_type({ oneOf: [{ $ref: "types.yaml#/definitions/flag" }, { $ref: "types.yaml#/definitions/uint32-matrix" }] })).toBe("uint32-matrix");
        expect(counted_type({ anyOf: [{ type: "boolean" }, { $ref: "types.yaml#/definitions/uint32" }] })).toBe("uint32");
        expect(counted_type({ oneOf: [{ $ref: "types.yaml#/definitions/phandle" }, { $ref: "types.yaml#/definitions/phandle-array" }] })).toBeUndefined();
        expect(counted_type({ oneOf: [{ $ref: "types.yaml#/definitions/flag" }, { maxItems: 1 }] })).toBeUndefined();
        expect(counted_type({ $ref: "types.yaml#/definitions/flag" })).toBeUndefined();

        const directory = fs.mkdtempSync(path.join(tmpdir(), "attach-dt-schema-"));
        try {
            fs.mkdirSync(path.join(directory, "dtschema/schemas"), { recursive: true });
            fs.mkdirSync(path.join(directory, "dtschema/schemas/pci"));
            fs.writeFileSync(path.join(directory, "dtschema/schemas/pci/pci-bus-common.yaml"), [
                "properties:",
                "  ranges:",
                "    oneOf:",
                "      - type: boolean",
                "      - maxItems: 32",
            ].join("\n"));
            fs.writeFileSync(path.join(directory, "dtschema/schemas/reg.yaml"), [
                "properties:",
                "  ranges:",
                "    oneOf:",
                "      - $ref: types.yaml#/definitions/flag",
                "      - $ref: types.yaml#/definitions/uint32-matrix",
                "  reg:",
                "    $ref: types.yaml#/definitions/address",
            ].join("\n"));
            const types = load_property_types(directory);
            expect(types.names.get("ranges")).toBe("flag");
            expect([...types.counted ?? []]).toStrictEqual([["ranges", "uint32-matrix"]]);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("a matrix type and the range of its cells", () => {
        for (const type of ["address", "phandle", "phandle-array", "uint32-matrix", "int8-matrix"]) { expect(is_matrix_type(type)).toBe(true); }
        for (const type of ["uint32-array", "uint32", "string-array", "flag"]) { expect(is_matrix_type(type)).toBe(false); }
        expect(cell_range("uint32-matrix")).toStrictEqual({ minimum: 0n, maximum: 0xFF_FF_FF_FFn });
        expect(cell_range("address")).toStrictEqual({ minimum: 0n, maximum: 0xFF_FF_FF_FFn });
        expect(cell_range("int8-array")).toStrictEqual({ minimum: -128n, maximum: 127n });
        expect(cell_range("phandle-array")).toBeUndefined();
    });

    test("the types of a processed schema fill in the names dt-schema doesn't know: one type per name, none for a name typed two ways or as a node, a phandle-array for a phandle and a phandle-array, a flag for a flag and a number", () => {
        const directory = fs.mkdtempSync(path.join(tmpdir(), "attach-processed-"));
        const file = path.join(directory, "processed-schema.json");
        try {
            fs.writeFileSync(file, `{
                "generated-types": { "properties": {
                    "nvmem-cells": [{ "type": "phandle-array" }, { "type": "phandle-array" }],
                    "resets": [{ "type": "phandle" }, { "type": "phandle-array" }],
                    "usb-phy": [{ "type": "phandle-array" }, { "type": "phandle" }],
                    "drive-open-drain": [{ "type": "flag" }, { "type": "uint32" }],
                    "bitclock-master": [{ "type": "flag" }, { "type": "phandle" }],
                    "pins": [{ "type": "string-array" }, { "type": "uint32-array" }],
                    "port": [{ "type": "node" }],
                    "reg": [{ "type": null }, { "type": "address" }]
                } },
                "generated-pattern-types": { "properties": { "^#.*-cells$": [{ "type": "uint32" }], "(?P<x>a)": [{ "type": "flag" }] } }
            }`);

            const base: PropertyTypes = { names: new Map([["resets", "phandle-array"]]), patterns: [{ pattern: /-gpios$/, type: "phandle-array" }] };
            const types = load_processed_property_types(file, base);
            expect([...types.names]).toStrictEqual([["resets", "phandle-array"], ["nvmem-cells", "phandle-array"], ["usb-phy", "phandle-array"], ["drive-open-drain", "flag"], ["reg", "address"]]);
            expect(types.patterns.map(({ pattern, type }) => [pattern.source, type])).toStrictEqual([["-gpios$", "phandle-array"], ["^#.*-cells$", "uint32"]]);
            expect(load_processed_property_types(path.join(directory, "missing.json"), base)).toBe(base);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("a name's type is found by name before pattern", () => {
        const types: PropertyTypes = {
            names: new Map([["clocks", "phandle-array"], ["power-domain-names", "string-array"]]),
            patterns: [{ pattern: /-names$/, type: "string-array" }, { pattern: /-gpios?$/, type: "phandle-array" }, { pattern: /^power-/, type: "flag" }],
        };
        expect(property_type(types, "clocks")).toBe("phandle-array");
        expect(property_type(types, "power-domain-names")).toBe("string-array");
        expect(property_type(types, "reset-gpios")).toBe("phandle-array");
        expect(property_type(types, "adi,thing")).toBeUndefined();
    });
}
