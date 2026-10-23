import { FixupContext, PropertySchema } from "../FixupWalker.js";

/** Whether every branch is a `const`, with at most a `description` beside it. */
function is_const_only(branches: unknown): branches is Record<string, unknown>[] {
    return Array.isArray(branches) && branches.length > 0 && branches.every(branch =>
        typeof branch === "object" && branch !== null && "const" in branch &&
        Object.keys(branch).every(key => key === "const" || key === "description"));
}

function to_enum(schema: Record<string, unknown>): void {
    const key = "anyOf" in schema ? "anyOf" : "oneOf";
    const branches = schema[key];

    if (!is_const_only(branches)) { return; }

    delete schema[key];
    schema["enum"] = branches.map(branch => branch["const"]);
}

/**
 * dt-schema: `fixups.py:_fixup_oneOf_to_enum`. A `oneOf` / `anyOf` of nothing but `const`s (their `description`s
 * aside) is an `enum`; when `items` is a schema, the same goes for it.
 */
export function fixup_oneof_to_enum(schema: PropertySchema, _context: FixupContext): PropertySchema {
    if (typeof schema === "boolean") { return schema; }

    const items = schema["items"];
    if (typeof items === "object" && items !== null && !Array.isArray(items)) {
        to_enum(items as Record<string, unknown>);
        return schema;
    }

    to_enum(schema);
    return schema;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const fixup = (schema: PropertySchema) => fixup_oneof_to_enum(schema, { path: ["properties", "p"], name: "p" });

    test("a oneOf of consts is an enum, descriptions dropped", () => {
        expect(fixup({ oneOf: [{ const: "a", description: "first" }, { const: "b" }] })).toStrictEqual({ enum: ["a", "b"] });
    });

    test("an anyOf of consts is an enum", () => {
        expect(fixup({ anyOf: [{ const: 0 }, { const: 1 }, { const: 2 }], description: "kept" })).toStrictEqual({ enum: [0, 1, 2], description: "kept" });
    });

    test("an entry with another key leaves the schema alone", () => {
        const schema = { oneOf: [{ const: 1 }, { const: 2, deprecated: true }] };
        expect(fixup(structuredClone(schema))).toStrictEqual(schema);
    });

    test("an entry that is not a const leaves the schema alone", () => {
        const schema = { oneOf: [{ const: 1 }, { type: "integer" }] };
        expect(fixup(structuredClone(schema))).toStrictEqual(schema);
    });

    test("the items of a schema are converted, not the schema", () => {
        expect(fixup({ items: { oneOf: [{ const: "a" }, { const: "b" }] }, oneOf: [{ const: "c" }] }))
            .toStrictEqual({ items: { enum: ["a", "b"] }, oneOf: [{ const: "c" }] });
    });

    test("it changes the schema in place", () => {
        const schema = { oneOf: [{ const: "a" }] };
        expect(fixup(schema)).toBe(schema);
    });

    test("a boolean is returned unchanged", () => {
        expect(fixup(true)).toBe(true);
        expect(fixup(false)).toBe(false);
    });
}
