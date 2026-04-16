import { CellArrayElement, DtsCellArray, DtsProperty } from "./dts";
import { print_property } from "./dts/printer";

interface IFlagPropertyBuilder {
    set_flag: () => INameBuilder;
}

interface IStringPropertyBuilder {
    with_value: (first: string | string[], ...rest: (string | string[])[]) => INameBuilder;
}

interface IReferencePropertyBuilder {
    with_label: (label: string) => INameBuilder;
    with_path: (path: string) => INameBuilder;
}

type TaggedNumber = {
    _tag: "number",
    value: bigint
}

type TaggedU64 = {
    _tag: "u64",
    value: bigint
}

type TaggedLabel = {
    _tag: "label";
    value: string
}

type TaggedPath = {
    _tag: "path";
    value: string
}

type TaggedExpression = {
    _tag: "expression";
    value: string
}

type TaggedCellValue = TaggedNumber | TaggedU64 | TaggedLabel | TaggedPath | TaggedExpression;

interface ICellArrayPropertyBuilder {
    with_tagged_values: (first: TaggedCellValue | TaggedCellValue[], ...rest: (TaggedCellValue | TaggedCellValue[])[]) => INameBuilder;
}

interface INameBuilder {
    with_name: (name: string) => IBuild;
}

interface IBuild {
    with_labels: (labels: string[]) => IBuild;
    with_user_modifications: (modified_by_user: boolean) => IBuild;
    build: () => DtsProperty;
}

class PropertyBuilder implements
    IFlagPropertyBuilder,
    IStringPropertyBuilder,
    IReferencePropertyBuilder,
    ICellArrayPropertyBuilder,
    INameBuilder,
    IBuild {

    private property: DtsProperty = {
        labels: [],
        name: "",
        value: undefined,
        deleted: false,
        modified_by_user: false,
    };

    private constructor() {
    }

    static build_flag(): IFlagPropertyBuilder {
        return new PropertyBuilder();
    }

    static build_string(): IStringPropertyBuilder {
        return new PropertyBuilder;
    }

    static build_reference(): IReferencePropertyBuilder {
        return new PropertyBuilder;
    }

    static build_cell_array(): ICellArrayPropertyBuilder {
        return new PropertyBuilder;
    }

    set_flag(): INameBuilder {
        this.property.value = undefined;
        return this;
    }

    with_value(first: string | string[], ...rest: (string | string[])[]): INameBuilder {

        const flattened_rest = rest.flat();
        const normalized_value = first === undefined ? flattened_rest : (Array.isArray(first) ? [...first, ...flattened_rest] : [first, ...flattened_rest]);

        this.property.value = {
            components: []
        };

        for (const entry of normalized_value) {
            this.property.value.components.push({
                kind: "string",
                value: entry,
                labels: []
            });
        }

        return this;
    }

    with_label(label: string): INameBuilder {
        this.property.value = {
            components: [{
                kind: "ref",
                labels: [],
                ref: {
                    kind: 'label',
                    name: label
                }
            }]
        };
        return this;
    }

    with_path(path: string): INameBuilder {
        this.property.value = {
            components: [{
                kind: "ref",
                labels: [],
                ref: {
                    kind: 'path',
                    path: path
                }
            }]
        };
        return this;
    }


    with_tagged_values(first: TaggedCellValue | TaggedCellValue[], ...rest: (TaggedCellValue | TaggedCellValue[])[]): INameBuilder {

        const tagged_to_element = (entry: TaggedCellValue): CellArrayElement => {
            switch (entry._tag) {
                case "number": {
                    return { item: { kind: "number", value: entry.value, labels: [] } };
                }
                case "u64": {
                    return { item: { kind: "u64", value: entry.value, labels: [] } };
                }
                case "label": {
                    return { item: { kind: "ref", labels: [], ref: { kind: "label", name: entry.value } } };
                }
                case "path": {
                    return { item: { kind: "ref", labels: [], ref: { kind: "path", path: entry.value } } };
                }
                case "expression": {
                    return { item: { kind: "expression", labels: [], value: entry.value } };
                }
                default: {
                    const _x: never = entry;
                    throw new Error("Exhaustive check failed!");
                }
            }
        };

        const make_cell_array = (values: TaggedCellValue[]): DtsCellArray => ({
            kind: "array",
            labels: [],
            elements: values.map((v) => tagged_to_element(v)),
        });

        const is_not_2d = (array: (TaggedCellValue | TaggedCellValue[])[]): array is TaggedCellValue[] => {
            for (const value of array) {
                if (Array.isArray(value)) { return false; }
            }

            return true;
        };

        const rest_array_count: number = (() => {
            let count = 0;
            for (const entry of rest) {
                if (Array.isArray(entry)) {
                    count++;
                }
            }
            return count;
        })();

        // needs type inference
        if (rest_array_count === 0 && is_not_2d(rest)) {
            // Single component mode: flatten first + rest into one component
            const normalized_values = (Array.isArray(first) ? [...first, ...rest] : [first, ...rest]);
            this.property.value = {
                components: [make_cell_array(normalized_values)]
            };
        } else if (!Array.isArray(first) && rest_array_count === 1) {

            const normalized_values: TaggedCellValue[] = [first];

            for (const entry of rest) {
                if (Array.isArray(entry)) {
                    normalized_values.push(...entry);
                    continue;
                }
                normalized_values.push(entry);
            }

            this.property.value = {
                components: [make_cell_array(normalized_values)]
            };
        }
        else {
            // Multiple components mode: each array becomes a component, each single value becomes a single-element component
            const all_arguments: (TaggedCellValue | TaggedCellValue[])[] = [first, ...rest];
            this.property.value = {
                components: all_arguments.map((argument) => make_cell_array(Array.isArray(argument) ? argument : [argument]))
            };
        }

        return this;
    }

    with_name(name: string): IBuild {
        this.property.name = name;
        return this;
    }

    with_labels(labels: string[]): IBuild {
        this.property.labels = labels;
        return this;
    }

    with_user_modifications(modified_by_user: boolean): IBuild {
        this.property.modified_by_user = modified_by_user;
        return this;
    }

    build(): DtsProperty {
        return this.property;
    }

    static to_string(property: DtsProperty): string {
        return print_property(property, "", 0);
    }

    static tag_number(value: number | bigint) { return { _tag: "number" as const, value: BigInt(value) }; };
    static tag_u64(value: number | bigint) { return { _tag: "u64" as const, value: BigInt(value) }; };
    static tag_label(value: string) { return { _tag: "label" as const, value: value }; };
    static tag_path(value: string) { return { _tag: "path" as const, value: value }; };
    static tag_expression(value: string) { return { _tag: "expression" as const, value: value }; };
}

if (import.meta.vitest !== undefined) {

    const { test, expect } = import.meta.vitest;

    test(`Flag Builder`, () => {

        const expected_flag: DtsProperty = {
            labels: [],
            name: "spi-controller",
            value: undefined,
            deleted: false,
            modified_by_user: true
        };

        const flag: DtsProperty = PropertyBuilder.build_flag()
            .set_flag()
            .with_name(expected_flag.name)
            .with_labels(expected_flag.labels)
            .with_user_modifications(expected_flag.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(flag)}`);

        expect(flag).toStrictEqual(expected_flag);
    });

    test(`String Builder`, () => {

        const string_value: string = "adi,ad7124";

        const expected_compatible: DtsProperty = {
            labels: [],
            name: "compatible",
            value: {
                components: [
                    {
                        kind: 'string',
                        value: string_value,
                        labels: []
                    }
                ]
            },
            deleted: false,
            modified_by_user: false
        };

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(string_value)
            .with_name(expected_compatible.name)
            .with_labels([])
            .with_user_modifications(expected_compatible.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Array String Builder`, () => {
        const string_values: string[] = ["adi,ad7124", "adi,adxl355"];

        const expected_compatible: DtsProperty = {
            labels: [],
            name: "compatible",
            value: {
                components: []
            },
            deleted: false,
            modified_by_user: false
        };

        for (const entry of string_values) {
            expected_compatible.value?.components.push(
                {
                    kind: 'string',
                    labels: [],
                    value: entry
                }
            );
        }

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(string_values)
            .with_name(expected_compatible.name)
            .with_labels([])
            .with_user_modifications(expected_compatible.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Variadic String Builder`, () => {
        const string1_value: string = "adi,ad7124";
        const string2_value: string = "adi,adxl355";

        const expected_compatible: DtsProperty = {
            labels: [],
            name: "compatible",
            value: {
                components: [
                    {
                        kind: 'string',
                        labels: [],
                        value: string1_value
                    },
                    {
                        kind: 'string',
                        labels: [],
                        value: string2_value
                    }
                ]
            },
            deleted: false,
            modified_by_user: false
        };

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(string1_value, string2_value)
            .with_name(expected_compatible.name)
            .with_labels([])
            .with_user_modifications(expected_compatible.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });


    test(`Variadic String Array Builder`, () => {
        const string1_values: string[] = ["adi,ad7124-4", "adi,ad7124-8"];
        const string2_values: string[] = ["adi,adxl355"];

        const composed = [...string1_values, ...string2_values];

        const expected_compatible: DtsProperty = {
            labels: [],
            name: "compatible",
            value: {
                components: []
            },
            deleted: false,
            modified_by_user: false
        };

        for (const entry of composed) {
            expected_compatible.value?.components.push(
                {
                    kind: 'string',
                    labels: [],
                    value: entry
                }
            );
        }

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(string1_values, string2_values)
            .with_name(expected_compatible.name)
            .with_labels([])
            .with_user_modifications(expected_compatible.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Variadic String Array and String Builder 1`, () => {
        const string1_values: string[] = ["adi,ad7124-4", "adi,ad7124-8"];
        const string2_value: string = "adi,adxl355";

        const composed = [...string1_values, string2_value];

        const expected_compatible: DtsProperty = {
            labels: [],
            name: "compatible",
            value: {
                components: []
            },
            deleted: false,
            modified_by_user: false
        };

        for (const entry of composed) {
            expected_compatible.value?.components.push(
                {
                    kind: 'string',
                    labels: [],
                    value: entry
                }
            );
        }

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(string1_values, string2_value)
            .with_name(expected_compatible.name)
            .with_labels([])
            .with_user_modifications(expected_compatible.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Variadic String Array and String Builder 2`, () => {
        const string1_values: string = "adi,ad7124-4";
        const string2_value: string[] = ["adi,adxl355", "adi,ad7124-8"];

        const composed = [string1_values, ...string2_value];

        const expected_compatible: DtsProperty = {
            labels: [],
            name: "compatible",
            value: {
                components: []
            },
            deleted: false,
            modified_by_user: false
        };

        for (const entry of composed) {
            expected_compatible.value?.components.push(
                {
                    kind: 'string',
                    labels: [],
                    value: entry
                }
            );
        }

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(string1_values, string2_value)
            .with_name(expected_compatible.name)
            .with_labels([])
            .with_user_modifications(expected_compatible.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Variadic String Array and String Builder 3`, () => {
        const string1_values: string[] = ["adi,ad7124-4"];
        const string2_value: string = "adi,ad7124-8";
        const string3_values: string[] = ["adi,adxl355"];

        const composed = [...string1_values, string2_value, ...string3_values];

        const expected_compatible: DtsProperty = {
            labels: [],
            name: "compatible",
            value: {
                components: []
            },
            deleted: false,
            modified_by_user: false
        };

        for (const entry of composed) {
            expected_compatible.value?.components.push(
                {
                    kind: 'string',
                    labels: [],
                    value: entry
                }
            );
        }

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(string1_values, string2_value, string3_values)
            .with_name(expected_compatible.name)
            .with_labels([])
            .with_user_modifications(expected_compatible.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Reference with label Builder`, () => {

        const label_name: string = "gpio";

        const expected_label_reference: DtsProperty = {
            labels: [],
            name: "gpio0",
            value: {
                components: [
                    {
                        kind: "ref",
                        labels: [],
                        ref: {
                            kind: "label",
                            name: label_name
                        }
                    }
                ]
            },
            deleted: false,
            modified_by_user: false
        };

        const label_reference: DtsProperty = PropertyBuilder.build_reference()
            .with_label(label_name)
            .with_name(expected_label_reference.name)
            .with_labels(expected_label_reference.labels)
            .with_user_modifications(expected_label_reference.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(label_reference)}`);
        expect(label_reference).toStrictEqual(expected_label_reference);
    });

    test(`Reference with path Builder`, () => {
        const path: string = "/soc/gpio";

        const expected_path_reference: DtsProperty = {
            labels: [],
            name: "gpio0",
            value: {
                components: [
                    {
                        kind: "ref",
                        labels: [],
                        ref: {
                            kind: "path",
                            path: path
                        }
                    }
                ]
            },
            deleted: false,
            modified_by_user: false
        };

        const path_reference: DtsProperty = PropertyBuilder.build_reference()
            .with_path(path)
            .with_name(expected_path_reference.name)
            .with_labels(expected_path_reference.labels)
            .with_user_modifications(expected_path_reference.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(path_reference)}`);
        expect(path_reference).toStrictEqual(expected_path_reference);
    });

    test(`Cell Array Builder All Types Variadic`, () => {

        const expected_cell: DtsProperty = {
            labels: [],
            name: "unusual-cell",
            value: {
                components: [{
                    kind: "array",
                    labels: [],
                    elements: [
                        {
                            item: {
                                kind: "number",
                                value: 0n,
                                labels: []
                            }
                        },
                        {
                            item: {
                                kind: "u64",
                                value: 1n,
                                labels: []
                            }
                        },
                        {
                            item: {
                                kind: "ref",
                                ref: {
                                    kind: "label",
                                    name: "gpio0"
                                },
                                labels: []
                            },
                        },
                        {
                            item: {
                                kind: "ref",
                                ref: {
                                    kind: "path",
                                    path: "/soc/gpio0"
                                },
                                labels: []
                            },
                        },
                        {
                            item: {
                                kind: "expression",
                                value: "(1+1)",
                                labels: []
                            },
                        }
                    ]
                }]
            },
            deleted: false,
            modified_by_user: false
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(
                PropertyBuilder.tag_number(0),
                PropertyBuilder.tag_u64(1),
                PropertyBuilder.tag_label("gpio0"),
                PropertyBuilder.tag_path("/soc/gpio0"),
                PropertyBuilder.tag_expression("(1+1)")
            )
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder All Types Array`, () => {

        const values: TaggedCellValue[] = [
            PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)"),
        ];

        const cell_array: DtsCellArray = {
            kind: "array",
            labels: [],
            elements: []
        };

        for (const entry of values) {

            switch (entry._tag) {
                case "number":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "number",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
                case "u64":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "u64",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
                case "label":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "ref",
                                labels: [],
                                ref: {
                                    kind: "label",
                                    name: entry.value
                                }
                            }
                        });
                        break;
                    }
                case "path":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "ref",
                                labels: [],
                                ref: {
                                    kind: "path",
                                    path: entry.value
                                }
                            }
                        });
                        break;
                    }
                case "expression":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "expression",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
            }
        }

        const expected_cell: DtsProperty = {
            labels: [],
            name: "unusual-cell",
            value: {
                components: [cell_array]
            },
            deleted: false,
            modified_by_user: false
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder All Types Array and Variadic - 1`, () => {

        const value: TaggedCellValue = PropertyBuilder.tag_number(0);

        const values: TaggedCellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)"),
        ];

        const composed = [value, ...values];

        const cell_array: DtsCellArray = {
            kind: "array",
            labels: [],
            elements: []
        };

        for (const entry of composed) {

            switch (entry._tag) {
                case "number":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "number",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
                case "u64":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "u64",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
                case "label":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "ref",
                                labels: [],
                                ref: {
                                    kind: "label",
                                    name: entry.value
                                }
                            }
                        });
                        break;
                    }
                case "path":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "ref",
                                labels: [],
                                ref: {
                                    kind: "path",
                                    path: entry.value
                                }
                            }
                        });
                        break;
                    }
                case "expression":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "expression",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
            }
        }

        const expected_cell: DtsProperty = {
            labels: [],
            name: "unusual-cell",
            value: {
                components: [cell_array]
            },
            deleted: false,
            modified_by_user: false
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(value, values)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder All Types Array and Variadic - 2`, () => {

        const value: TaggedCellValue = PropertyBuilder.tag_number(0);

        const values: TaggedCellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)"),
        ];

        const composed = [...values, value];

        const cell_array: DtsCellArray = {
            kind: "array",
            labels: [],
            elements: []
        };

        for (const entry of composed) {

            switch (entry._tag) {
                case "number":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "number",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
                case "u64":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "u64",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
                case "label":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "ref",
                                labels: [],
                                ref: {
                                    kind: "label",
                                    name: entry.value
                                }
                            }
                        });
                        break;
                    }
                case "path":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "ref",
                                labels: [],
                                ref: {
                                    kind: "path",
                                    path: entry.value
                                }
                            }
                        });
                        break;
                    }
                case "expression":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "expression",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
            }
        }

        const expected_cell: DtsProperty = {
            labels: [],
            name: "unusual-cell",
            value: {
                components: [cell_array]
            },
            deleted: false,
            modified_by_user: false
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values, value)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder All Types Array and Variadic - 3`, () => {

        const value1: TaggedCellValue = PropertyBuilder.tag_number(0);

        const values: TaggedCellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const value2: TaggedCellValue = PropertyBuilder.tag_expression("(1+1)");

        const composed = [value1, ...values, value2];

        const cell_array: DtsCellArray = {
            kind: "array",
            labels: [],
            elements: []
        };

        for (const entry of composed) {

            switch (entry._tag) {
                case "number":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "number",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
                case "u64":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "u64",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
                case "label":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "ref",
                                labels: [],
                                ref: {
                                    kind: "label",
                                    name: entry.value
                                }
                            }
                        });
                        break;
                    }
                case "path":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "ref",
                                labels: [],
                                ref: {
                                    kind: "path",
                                    path: entry.value
                                }
                            }
                        });
                        break;
                    }
                case "expression":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "expression",
                                labels: [],
                                value: entry.value
                            }
                        });
                        break;
                    }
            }
        }

        const expected_cell: DtsProperty = {
            labels: [],
            name: "unusual-cell",
            value: {
                components: [cell_array]
            },
            deleted: false,
            modified_by_user: false
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(value1, values, value2)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder All Types Matrix of Arrays`, () => {
        const values1: TaggedCellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];
        const values2: TaggedCellValue[] = [PropertyBuilder.tag_number(0), PropertyBuilder.tag_expression("(1+1)")];

        const composed: TaggedCellValue[][] = [values1, values2];

        const cell_array_array: DtsCellArray[] = [];

        for (const entry of composed) {
            const cell_array: DtsCellArray = {
                kind: "array",
                labels: [],
                elements: []
            };

            for (const sub_entry of entry) {
                switch (sub_entry._tag) {
                    case "number":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "number",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                    case "u64":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "u64",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                    case "label":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "ref",
                                    labels: [],
                                    ref: {
                                        kind: "label",
                                        name: sub_entry.value
                                    }
                                }
                            });
                            break;
                        }
                    case "path":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "ref",
                                    labels: [],
                                    ref: {
                                        kind: "path",
                                        path: sub_entry.value
                                    }
                                }
                            });
                            break;
                        }
                    case "expression":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "expression",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                }
            }
            cell_array_array.push(cell_array);
        }

        const expected_cell: DtsProperty = {
            labels: [],
            name: "unusual-cell",
            value: {
                components: cell_array_array
            },
            deleted: false,
            modified_by_user: false
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values1, values2)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder All Types Matrix of Array and Variadic - 1`, () => {
        const values1: TaggedCellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const values2: TaggedCellValue[] = [
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const value: TaggedCellValue = PropertyBuilder.tag_number(0);

        const composed: TaggedCellValue[][] = [values1, values2, [value]];

        const cell_array_array: DtsCellArray[] = [];

        for (const entry of composed) {
            const cell_array: DtsCellArray = {
                kind: "array",
                labels: [],
                elements: []
            };

            for (const sub_entry of entry) {
                switch (sub_entry._tag) {
                    case "number":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "number",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                    case "u64":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "u64",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                    case "label":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "ref",
                                    labels: [],
                                    ref: {
                                        kind: "label",
                                        name: sub_entry.value
                                    }
                                }
                            });
                            break;
                        }
                    case "path":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "ref",
                                    labels: [],
                                    ref: {
                                        kind: "path",
                                        path: sub_entry.value
                                    }
                                }
                            });
                            break;
                        }
                    case "expression":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "expression",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                }
            }
            cell_array_array.push(cell_array);
        }

        const expected_cell: DtsProperty = {
            labels: [],
            name: "unusual-cell",
            value: {
                components: cell_array_array
            },
            deleted: false,
            modified_by_user: false
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values1, values2, value)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder All Types Matrix of Array and Variadic - 2`, () => {
        const values1: TaggedCellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const values2: TaggedCellValue[] = [
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const value: TaggedCellValue = PropertyBuilder.tag_number(0);

        const composed: TaggedCellValue[][] = [values1, [value], values2];

        const cell_array_array: DtsCellArray[] = [];

        for (const entry of composed) {
            const cell_array: DtsCellArray = {
                kind: "array",
                labels: [],
                elements: []
            };

            for (const sub_entry of entry) {
                switch (sub_entry._tag) {
                    case "number":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "number",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                    case "u64":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "u64",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                    case "label":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "ref",
                                    labels: [],
                                    ref: {
                                        kind: "label",
                                        name: sub_entry.value
                                    }
                                }
                            });
                            break;
                        }
                    case "path":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "ref",
                                    labels: [],
                                    ref: {
                                        kind: "path",
                                        path: sub_entry.value
                                    }
                                }
                            });
                            break;
                        }
                    case "expression":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "expression",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                }
            }
            cell_array_array.push(cell_array);
        }

        const expected_cell: DtsProperty = {
            labels: [],
            name: "unusual-cell",
            value: {
                components: cell_array_array
            },
            deleted: false,
            modified_by_user: false
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values1, value, values2)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder All Types Matrix of Array and Variadic - 3`, () => {
        const values1: TaggedCellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const values2: TaggedCellValue[] = [
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const value: TaggedCellValue = PropertyBuilder.tag_number(0);

        const composed: TaggedCellValue[][] = [[value], values1, values2];

        const cell_array_array: DtsCellArray[] = [];

        for (const entry of composed) {
            const cell_array: DtsCellArray = {
                kind: "array",
                labels: [],
                elements: []
            };

            for (const sub_entry of entry) {
                switch (sub_entry._tag) {
                    case "number":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "number",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                    case "u64":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "u64",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                    case "label":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "ref",
                                    labels: [],
                                    ref: {
                                        kind: "label",
                                        name: sub_entry.value
                                    }
                                }
                            });
                            break;
                        }
                    case "path":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "ref",
                                    labels: [],
                                    ref: {
                                        kind: "path",
                                        path: sub_entry.value
                                    }
                                }
                            });
                            break;
                        }
                    case "expression":
                        {
                            cell_array.elements.push({
                                item: {
                                    kind: "expression",
                                    labels: [],
                                    value: sub_entry.value
                                }
                            });
                            break;
                        }
                }
            }
            cell_array_array.push(cell_array);
        }

        const expected_cell: DtsProperty = {
            labels: [],
            name: "unusual-cell",
            value: {
                components: cell_array_array
            },
            deleted: false,
            modified_by_user: false
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(value, values1, values2)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });
}