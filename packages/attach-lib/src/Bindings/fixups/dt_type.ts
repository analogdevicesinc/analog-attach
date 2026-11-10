import { DT_TYPE } from "../stages/References.js";
import { in_branch, PropertyFixup } from "./Walker.js";
import { property_type, PropertyTypes } from "../schema/PropertyTypes.js";
import { PropertySchema } from "../schema/Schema.js";

/** Conditions on a node: what a property is there doesn't describe its value. */
const CONDITIONS = new Set(["if", "not", "select"]);

/** A property that holds child nodes (`cpus`, `port`) isn't the value the name's type is about. */
function is_node_schema(schema: PropertySchema): boolean {
    return typeof schema === "object" && (schema["type"] === "object" || ["properties", "patternProperties", "additionalProperties", "unevaluatedProperties"].some(key => key in schema));
}

/**
 * dt-schema: `validator.py:property_get_type`. A property that doesn't say what type it is (no `$ref` to
 * `types.yaml`, so no `dtType`) gets the one dt-schema's own schemas declare for its name. `reg: {maxItems: 1}`
 * is an `address`, `interrupts: {maxItems: 1}` a `uint32-matrix`. A `true` property becomes `{ dtType }`. A name
 * that is a flag or another type gets the other when the schema counts its items: `ranges: {maxItems: 1}` is a
 * `uint32-matrix`, `ranges: true` a `flag`. Where the property is defined: not in a condition, nor in a `then` /
 * `else` that only refines a definition of the node (`FixupContext.refines`), but in one that names a property the
 * node doesn't (rpmh's `vdd-l2-l3-supply: true`), as dt-schema types a name wherever it is.
 */
export function fixup_dt_type(types: PropertyTypes): PropertyFixup {
    return (schema, { path, name, refines }) => {
        if (path.at(-1) !== name || path.at(-2) !== "properties" || path.some(key => CONDITIONS.has(key))
            // Without the walk's `refines`, a `then` / `else` is taken to say more about a definition elsewhere
            || (refines ?? in_branch(path))) {
            return schema;
        }

        const counts = typeof schema === "object" && ["minItems", "maxItems", "items"].some(key => key in schema);
        const type = (counts ? types.counted?.get(name) : undefined) ?? property_type(types, name);

        if (type === undefined || schema === false || is_node_schema(schema)) { return schema; }
        if (schema === true) { return { [DT_TYPE]: type }; }

        // In place: the dereferenced schemas share objects, and a copy would split them
        schema[DT_TYPE] ??= type;
        return schema;
    };
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const types: PropertyTypes = {
        names: new Map([["reg", "address"], ["interrupts", "uint32-matrix"], ["ranges", "flag"]]),
        patterns: [{ pattern: /-gpios?$/, type: "phandle-array" }],
        counted: new Map([["ranges", "uint32-matrix"]]),
    };
    const tagged = (schema: PropertySchema, name: string, path = ["properties", name], refines?: boolean) =>
        fixup_dt_type(types)(schema, { path, name, ...(refines === undefined ? {} : { refines }) });

    test("a property without a type gets the one of its name", () => {
        expect(tagged({ maxItems: 1 }, "reg")).toStrictEqual({ maxItems: 1, dtType: "address" });
        expect(tagged({ minItems: 1 }, "interrupts")).toStrictEqual({ minItems: 1, dtType: "uint32-matrix" });
        expect(tagged({ maxItems: 1 }, "reset-gpios")).toStrictEqual({ maxItems: 1, dtType: "phandle-array" });
    });

    test("a name that is a flag or another type is the other when the schema counts its items", () => {
        expect(tagged({ maxItems: 1 }, "ranges")).toStrictEqual({ maxItems: 1, dtType: "uint32-matrix" });
        expect(tagged({ items: [{ description: "x" }] }, "ranges")).toStrictEqual({ items: [{ description: "x" }], dtType: "uint32-matrix" });
        expect(tagged({ description: "d" }, "ranges")).toStrictEqual({ description: "d", dtType: "flag" });
        expect(tagged(true, "ranges")).toStrictEqual({ dtType: "flag" });
    });

    test("a true property becomes its type", () => {
        expect(tagged(true, "interrupts")).toStrictEqual({ dtType: "uint32-matrix" });
    });

    test("a property that has a type, has no known one, is false, or is not the definition is left alone", () => {
        expect(tagged({ dtType: "uint32" }, "reg")).toStrictEqual({ dtType: "uint32" });
        expect(tagged({ maxItems: 1 }, "adi,thing")).toStrictEqual({ maxItems: 1 });
        expect(tagged(false, "reg")).toBe(false);
        expect(tagged({ type: "object", properties: {} }, "reg")).toStrictEqual({ type: "object", properties: {} });
        expect(tagged({ maxItems: 1 }, "reg", ["allOf", "then", "properties", "reg"])).toStrictEqual({ maxItems: 1 });
        expect(tagged({ maxItems: 1 }, "reg", ["allOf", "then", "properties", "reg"], true)).toStrictEqual({ maxItems: 1 });
        expect(tagged({ const: 1 }, "reg", ["if", "properties", "reg"])).toStrictEqual({ const: 1 });
    });

    test("a then branch that names a property the node doesn't define is its definition", () => {
        expect(tagged(true, "reset-gpios", ["allOf", "then", "properties", "reset-gpios"], false)).toStrictEqual({ dtType: "phandle-array" });
    });
}
