import { FixupContext, PropertySchema } from "../FixupWalker.js";

type Schema = Record<string, unknown>;

function is_schema(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What every one of `branches` keeps to: the lowest `minItems` and the highest `maxItems`, each when all of them give it. */
function branch_bounds(branches: unknown[]): { minItems?: number, maxItems?: number } {
    // A `true` branch takes any value
    if (branches.length === 0 || !branches.every(branch => is_schema(branch))) { return {}; }

    const side = (keyword: string, pick: (...bounds: number[]) => number): number | undefined => {
        const bounds = branches.map(branch => branch[keyword]);
        return bounds.every(bound => typeof bound === "number") ? pick(...bounds) : undefined;
    };
    return { minItems: side("minItems", Math.min), maxItems: side("maxItems", Math.max) };
}

/**
 * Ours. dt-validate holds a value to the `oneOf` / `anyOf` of its property too, so what all its branches keep to bounds
 * the property: `clock-names: {oneOf: [{items: [a, b]}, {items: [a, c, b]}]}` takes two or three, and
 * `data-lanes: {oneOf: [{items: [1, 2]}, {items: [1, 2, 3, 4]}]}` beside video-interfaces.yaml's one to eight two to
 * four. The property's own bounds are tightened by them. dt-schema has nothing like it, as it checks the branches
 * themselves; we read a property's counts from its own `minItems` / `maxItems` only. After `fixup_items_size`, which
 * the walk runs on the branches first.
 */
export function fixup_branch_counts(schema: PropertySchema, _context: FixupContext): PropertySchema {
    if (typeof schema === "boolean") { return schema; }

    for (const key of ["oneOf", "anyOf"]) {
        const branches = schema[key];
        if (!Array.isArray(branches)) { continue; }

        const { minItems, maxItems } = branch_bounds(branches);
        if (minItems !== undefined) {
            schema["minItems"] = typeof schema["minItems"] === "number" ? Math.max(schema["minItems"], minItems) : minItems;
        }
        if (maxItems !== undefined) {
            schema["maxItems"] = typeof schema["maxItems"] === "number" ? Math.min(schema["maxItems"], maxItems) : maxItems;
        }
    }
    return schema;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const counted = (schema: Schema) => {
        const fixuped = fixup_branch_counts(schema, { path: ["properties", "x"], name: "x" }) as Schema;
        return [fixuped["minItems"], fixuped["maxItems"]];
    };
    const sized = (minItems: number, maxItems: number) => ({ type: "array", minItems, maxItems });

    test("what all the branches of a oneOf or anyOf keep to bounds the property", () => {
        expect(counted({ oneOf: [sized(2, 2), sized(3, 3)] })).toStrictEqual([2, 3]);
        expect(counted({ anyOf: [sized(1, 4), sized(5, 7)] })).toStrictEqual([1, 7]);
    });

    test("the property's own bounds are tightened by them, not loosened", () => {
        expect(counted({ minItems: 1, maxItems: 8, oneOf: [sized(2, 2), sized(4, 4)] })).toStrictEqual([2, 4]);
        expect(counted({ minItems: 3, maxItems: 3, oneOf: [sized(2, 2), sized(4, 4)] })).toStrictEqual([3, 3]);
    });

    test("a side some branch doesn't bound, or a branch that takes anything, bounds nothing", () => {
        expect(counted({ minItems: 1, oneOf: [{ type: "array", maxItems: 1 }, sized(3, 3)] })).toStrictEqual([1, 3]);
        expect(counted({ oneOf: [{ type: "boolean" }, sized(1, 32)] })).toStrictEqual([undefined, undefined]);
        expect(counted({ oneOf: [true, sized(1, 2)] })).toStrictEqual([undefined, undefined]);
        expect(counted({ oneOf: [{ const: 0 }, { const: 1 }] })).toStrictEqual([undefined, undefined]);
    });
}
