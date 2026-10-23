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
};

export const NO_PROPERTY_TYPES: PropertyTypes = { names: new Map(), patterns: [] };

type Schema = Record<string, unknown>;

function is_schema(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// dt-schema: `validator.py:type_re`
const TYPE_NAME = /(address|flag|u?int(8|16|32|64)(-(array|matrix))?|string(-array)?|phandle(-array)?)/;

/** The type a property schema is declared with, going by its `$ref` (dt-schema: `validator.py:_extract_prop_type`). */
export function declared_type(schema: unknown): PropertyType | undefined {
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

    const types: PropertyTypes = { names: new Map(), patterns: [] };

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

/** The type of the property named `name`, by exact name first, then by pattern. */
export function property_type(types: PropertyTypes, name: string): PropertyType | undefined {
    return types.names.get(name) ?? types.patterns.find(({ pattern }) => pattern.test(name))?.type;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test("the type of a schema is the one its $ref names, as dt-schema reads it", () => {
        expect(declared_type({ $ref: "/schemas/types.yaml#/definitions/uint32-matrix", maxItems: 1 })).toBe("uint32-matrix");
        expect(declared_type({ $ref: "/schemas/types.yaml#/definitions/phandle-array" })).toBe("phandle-array");
        expect(declared_type({ $ref: "#/definitions/string-array" })).toBe("string-array");
        expect(declared_type({ allOf: [{ description: "x" }, { $ref: "/schemas/types.yaml#/definitions/phandle" }] })).toBe("phandle");
        expect(declared_type({ type: "boolean" })).toBe("flag");
        expect(declared_type({ maxItems: 1 })).toBeUndefined();
        expect(declared_type(true)).toBeUndefined();
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
