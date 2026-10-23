import { FixupContext, PropertySchema } from "../FixupWalker.js";

/**
 * dt-schema's `schemas/dt-core.yaml` types every `.*-names$` property as
 * `types.yaml#/definitions/non-unique-string-array` (`type: array`, `items: {type: string}`,
 * `minItems: 1`). dt-schema checks that as a separate schema on every node; we don't apply
 * dt-core, so the binding's own schema gets it. What the binding gives (its `items`, a bound) wins.
 */
export function fixup_names(schema: PropertySchema, { name }: FixupContext): PropertySchema {
    if (!name.endsWith("-names") || typeof schema === "boolean") { return schema; }

    return { type: "array", items: { type: "string" }, minItems: 1, ...schema };
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const names = (schema: PropertySchema, name = "clock-names") => fixup_names(schema, { path: ["properties", name], name });

    test("a names property without items is a list of strings", () => {
        expect(names({ description: "d" })).toStrictEqual({ type: "array", items: { type: "string" }, minItems: 1, description: "d" });
    });

    test("what the schema gives wins", () => {
        const given = { items: [{ const: "mclk" }], minItems: 2 };
        expect(names(given)).toStrictEqual({ type: "array", items: [{ const: "mclk" }], minItems: 2 });
    });

    test("another property and a boolean are left alone", () => {
        expect(names({ description: "d" }, "clocks")).toStrictEqual({ description: "d" });
        expect(names(true)).toBe(true);
    });
}
