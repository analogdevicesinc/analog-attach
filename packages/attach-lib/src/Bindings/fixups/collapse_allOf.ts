import { DtBindingSchema, is_schema, Schema } from "../Schema.js";
import { is_node_pattern } from "../PatternKind.js";

/**
 * `over` on top of `base`. The properties of a node (`properties`, `patternProperties`) are merged by name and
 * `required` is joined, so a node that an `allOf` branch describes and the property adds to keeps both; any
 * other keyword of `over` replaces the one of `base`.
 */
function merge_schemas(base: Schema, over: Schema): Schema {
    const result: Schema = { ...base };

    for (const [key, value] of Object.entries(over)) {
        const before = base[key];

        if ((key === "properties" || key === "patternProperties") && is_schema(before) && is_schema(value)) {
            const by_name: Schema = { ...before };
            for (const [name, schema] of Object.entries(value)) {
                by_name[name] = is_schema(by_name[name]) && is_schema(schema) ? merge_schemas(by_name[name], schema) : schema;
            }
            result[key] = by_name;
        } else if (key === "required" && Array.isArray(before) && Array.isArray(value)) {
            result[key] = [...new Set([...before, ...value])];
        } else {
            result[key] = value;
        }
    }

    return result;
}

/** Whether `value` has one of `keys` at any depth, not looking under the keys of `skip`. */
function has_key(value: unknown, keys: string[], skip: string[] = []): boolean {
    if (typeof value !== "object" || value === null) { return false; }
    return Object.entries(value).some(([key, entry]) => keys.includes(key) || (!skip.includes(key) && has_key(entry, keys, skip)));
}

/**
 * A property with an `allOf` and no other combinator (not one in `items`: it chooses what a cell is, a phandle or 0,
 * and the merge copies it as it is).
 */
function is_collapsible(property: unknown): boolean {
    return !has_key(property, ["oneOf", "anyOf", "not"], ["items"]) && has_key(property, ["allOf"]);
}

/**
 * The properties of `node` with their `allOf` collapsed, and the patterns that name properties rather than child
 * nodes; then the same for each child node. Not those of an `if` / `then` branch: they only add to a property.
 */
function collapse_properties(node: Schema): Schema {
    let result: Schema | undefined;

    for (const key of ["properties", "patternProperties"]) {
        const table = node[key];
        if (!is_schema(table)) { continue; }

        const collapsed = Object.fromEntries(Object.entries(table).map(([name, property]) => {
            if ((key === "properties" || !is_node_pattern(name, property)) && is_collapsible(property)) {
                return [name, collapse_allOf(property)];
            }
            return [name, is_schema(property) ? collapse_properties(property) : property];
        }));
        if (Object.entries(collapsed).some(([name, property]) => property !== table[name])) {
            (result ??= { ...node })[key] = collapsed;
        }
    }

    return result ?? node;
}

export function fixup_collapse_allOf(binding: DtBindingSchema): DtBindingSchema {
    return collapse_properties(binding) as DtBindingSchema;
}

/**
 * `input` with each `allOf`, at any depth, merged into the schema it is in: what its branches say first, then the
 * schema's own keys (`$ref: string` beside `items: {enum}` dereferences to an allOf with `items: {type: string}`,
 * which doesn't beat the `enum`).
 */
function collapse_allOf(input: unknown): unknown {
    if (Array.isArray(input)) {
        return input.map(element => collapse_allOf(element));
    }
    if (!is_schema(input)) {
        return input;
    }

    let flattened_branches: Schema = {};
    const own: Schema = {};

    for (const [key, value] of Object.entries(input)) {
        if (key === "allOf" && Array.isArray(value)) {
            for (const entry of value) {
                const flattened = collapse_allOf(entry);
                if (is_schema(flattened)) {
                    flattened_branches = merge_schemas(flattened_branches, flattened);
                }
            }
        } else {
            own[key] = collapse_allOf(value);
        }
    }

    return merge_schemas(flattened_branches, own);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test(fixup_collapse_allOf, () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties: {
                regulator_name: {
                    description: "A string used as a descriptive name for regulator outputs",
                    allOf: [
                        {
                            allOf: [
                                {
                                    type: "array",
                                    items: {
                                        type: "string"
                                    },
                                    minItems: 1
                                },
                                {
                                    uniqueItems: true
                                }
                            ]
                        },
                        {
                            maxItems: 1
                        }
                    ]
                }
            }
        };

        const fixup = fixup_collapse_allOf(binding);

        expect(fixup).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties: {
                regulator_name: {
                    description: "A string used as a descriptive name for regulator outputs",
                    type: "array",
                    items: {
                        type: "string"
                    },
                    minItems: 1,
                    uniqueItems: true,
                    maxItems: 1
                }
            }
        });
    });

    test("the properties of a child node are collapsed, those of an if branch are not", () => {

        const divider = { allOf: [{ $ref: "uint32" }, { minimum: 1 }, { maximum: 4095 }], maxItems: 1 };
        const binding = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            patternProperties: {
                "^channel@[0-9]$": { type: "object", properties: { "adi,divider": divider } },
            },
            // eslint-disable-next-line unicorn/no-thenable
            allOf: [{ if: { required: ["a"] }, then: { properties: { "adi,divider": divider } } }],
        } as unknown as DtBindingSchema;

        const fixup = fixup_collapse_allOf(binding) as unknown as typeof binding & { patternProperties: Record<string, { properties: Schema }> };

        expect(fixup.patternProperties["^channel@[0-9]$"]?.properties["adi,divider"]).toStrictEqual({ $ref: "uint32", minimum: 1, maximum: 4095, maxItems: 1 });
        expect(fixup.allOf).toStrictEqual(binding.allOf);
    });

    test("a node whose allOf holds a phandle (a oneOf in its cells) is collapsed, one with a oneOf of its own is not", () => {

        const phandle = { type: "array", items: { type: "array", items: [{ oneOf: [{ minimum: 1 }, { const: 0 }] }] } };
        const binding = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties: {
                endpoint: { type: "object", allOf: [{ properties: { "remote-endpoint": phandle } }], properties: { "bus-width": { maximum: 32 } } },
                mode: { allOf: [{ maximum: 3 }], oneOf: [{ const: 1 }, { const: 2 }] },
            },
        } as unknown as DtBindingSchema;

        const fixup = fixup_collapse_allOf(binding) as unknown as { properties: Schema };

        expect(fixup.properties["endpoint"]).toStrictEqual({ type: "object", properties: { "remote-endpoint": phandle, "bus-width": { maximum: 32 } } });
        expect(fixup.properties["mode"]).toStrictEqual(binding.properties?.["mode"]);
    });

    test("a property's own keywords beat the ones of its allOf, and the properties of a node are joined", () => {

        const property = {
            allOf: [{ items: { type: "string" }, maxItems: 1 }],
            items: { enum: ["cpu", "codec"] },
        };
        const port = {
            allOf: [{ properties: { reg: { maxItems: 1 } }, required: ["reg"] }],
            properties: { "bus-width": { maxItems: 1 } },
            required: ["bus-width"],
        };

        expect(collapse_allOf(property)).toStrictEqual({ maxItems: 1, items: { enum: ["cpu", "codec"] } });
        expect(collapse_allOf(port)).toStrictEqual({
            properties: { reg: { maxItems: 1 }, "bus-width": { maxItems: 1 } },
            required: ["reg", "bus-width"],
        });
    });
}
