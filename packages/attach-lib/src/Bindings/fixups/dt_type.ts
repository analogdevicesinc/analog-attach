import { DT_TYPE } from "../RefResolver.js";
import { PropertyFixup, PropertySchema } from "../FixupWalker.js";
import { property_type, PropertyTypes } from "../PropertyTypes.js";

/** Places a schema describes the property's own value in; the rest (conditions, refinements) only say more about it. */
const NOT_THE_DEFINITION = new Set(["if", "not", "select", "then", "else"]);

/** A property that holds child nodes (`cpus`, `port`) isn't the value the name's type is about. */
function is_node_schema(schema: PropertySchema): boolean {
    return typeof schema === "object" && (schema["type"] === "object" || ["properties", "patternProperties", "additionalProperties", "unevaluatedProperties"].some(key => key in schema));
}

/**
 * dt-schema: `validator.py:property_get_type`. A property that doesn't say what type it is (no `$ref` to
 * `types.yaml`, so no `dtType`) gets the one dt-schema's own schemas declare for its name. `reg: {maxItems: 1}`
 * is an `address`, `interrupts: {maxItems: 1}` a `uint32-matrix`. A `true` property becomes `{ dtType }`.
 */
export function fixup_dt_type(types: PropertyTypes): PropertyFixup {
    return (schema, { path, name }) => {
        if (path.at(-1) !== name || path.at(-2) !== "properties" || path.some(key => NOT_THE_DEFINITION.has(key))) {
            return schema;
        }

        const type = property_type(types, name);

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
        names: new Map([["reg", "address"], ["interrupts", "uint32-matrix"]]),
        patterns: [{ pattern: /-gpios?$/, type: "phandle-array" }],
    };
    const tagged = (schema: Record<string, unknown> | boolean, name: string, path = ["properties", name]) => fixup_dt_type(types)(schema, { path, name });

    test("a property without a type gets the one of its name", () => {
        expect(tagged({ maxItems: 1 }, "reg")).toStrictEqual({ maxItems: 1, dtType: "address" });
        expect(tagged({ minItems: 1 }, "interrupts")).toStrictEqual({ minItems: 1, dtType: "uint32-matrix" });
        expect(tagged({ maxItems: 1 }, "reset-gpios")).toStrictEqual({ maxItems: 1, dtType: "phandle-array" });
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
        expect(tagged({ const: 1 }, "reg", ["if", "properties", "reg"])).toStrictEqual({ const: 1 });
    });
}
