import { DtBindingSchema } from "../Schema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities.js";
import { is_node_pattern } from "../PatternKind.js";

type Schema = Record<string, any>;

function is_schema(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

/**
 * Whether `path` is the `properties` or `patternProperties` of the binding's node, or of a child node
 * (`patternProperties/^channel@/properties`). Not those of an `if` / `then` branch: they only add to a property.
 */
function is_property_table(path: string[]): boolean {
    return path.length % 2 === 1 && path.every((segment, index) => index % 2 === 1 || segment === 'properties' || segment === 'patternProperties');
}

export function fixup_collapse_allOf(binding: DtBindingSchema): DtBindingSchema {

    const properties = find_entry_in_object(
        binding,
        (path, key, value) => {
            if (!is_property_table(path)) {
                return false;
            }

            // The properties, and the patterns that name properties rather than child nodes.
            if (path.at(-1) === 'properties') {
                return true;
            }

            return !is_node_pattern(key, value);
        }
    );

    const to_collapse = properties.filter((property) => {

        const has_other_combinator = find_entry_in_object(
            property.value,
            (_path, key, _value) => {
                if (key === 'oneOf' || key === 'anyOf' || key === 'not') {
                    return true;
                }

                return false;
            }
        );

        if (has_other_combinator.length > 0) {
            return false;
        }

        const has_allOf = find_entry_in_object(
            property.value,
            (_path, key, _value) => {
                if (key === 'allOf') {
                    return true;
                }

                return false;
            }
        );

        if (has_allOf.length > 0) {
            return true;
        }

        return false;
    });

    const collapsed = to_collapse.map((property) => {
        const new_value = collapse_allOf(property.value as Record<string, any>[]);


        return {
            path: [...property.path, property.key],
            value: { ...new_value }
        };
    });

    return overwrite_object_with_path_value(binding, collapsed);
}


export function collapse_allOf(input: Record<string, any>): Record<string, any> {
    function recurse(value: any): any {
        if (Array.isArray(value)) {
            return value.map((element) => recurse(element));
        }

        if (value !== undefined && typeof value === "object") {
            // What the allOf branches say first, then the schema's own keys: `$ref: string` beside `items: {enum}`
            // dereferences to an allOf with `items: {type: string}`, which doesn't beat the `enum`.
            let flattened_branches: Record<string, any> = {};
            const own: Record<string, any> = {};

            for (const [key, inner_value] of Object.entries(value)) {
                if (key === "allOf" && Array.isArray(inner_value)) {
                    for (const entry of inner_value) {
                        const flattened = recurse(entry);

                        if (
                            flattened !== undefined &&
                            typeof flattened === "object" &&
                            !Array.isArray(flattened)
                        ) {
                            flattened_branches = merge_schemas(flattened_branches, flattened);
                        }
                    }
                } else {
                    own[key] = recurse(inner_value);
                }
            }

            const result = merge_schemas(flattened_branches, own);

            return result;
        }

        return value;
    }

    return recurse(input);
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

        const fixup = fixup_collapse_allOf(binding) as unknown as typeof binding & { patternProperties: Record<string, { properties: Record<string, unknown> }> };

        expect(fixup.patternProperties["^channel@[0-9]$"]?.properties["adi,divider"]).toStrictEqual({ $ref: "uint32", minimum: 1, maximum: 4095, maxItems: 1 });
        expect(fixup.allOf).toStrictEqual(binding.allOf);
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
