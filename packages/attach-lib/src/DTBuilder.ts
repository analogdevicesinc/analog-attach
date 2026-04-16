/* eslint-disable unicorn/consistent-function-scoping */
import { CellArrayElement, DtsCellArray, DtsProperty } from "./dts";
import { print_property } from "./dts/printer";

interface IFlagPropertyBuilder {
    set_flag: () => INameBuilder;
}

type LabeledString = {
    value: string,
    labels: string[]
}

type StringORLabeledString = string | LabeledString;
type StringsORLabeledStrings = string | string[] | LabeledString | LabeledString[];

interface IStringPropertyBuilder {
    with_value: (first: StringsORLabeledStrings, ...rest: StringsORLabeledStrings[]) => INameBuilder;
}

interface IReferencePropertyBuilder {
    with_label: (label: StringORLabeledString) => INameBuilder;
    with_path: (path: StringORLabeledString) => INameBuilder;
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

function is_tagged_cell_value(object: any): object is TaggedCellValue {
    if (object === null && typeof object !== 'object') {
        return false;
    }

    if (!("_tag" in object)) {
        return false;
    }

    if (!["number", "u64", "label", "path", "expression"].includes(object._tag)) {
        return false;
    }

    if (!("value" in object)) {
        return false;
    }

    if (!['string', 'bigint'].includes(typeof object.value)) {
        return false;
    }

    if (Object.entries(object).length !== 2) {
        return false;
    }

    return true;
}

function is_tagged_cell_value_array(object: any): object is TaggedCellValue[] {
    if (!Array.isArray(object)) {
        return false;
    }

    if (!object.every((entry) => is_tagged_cell_value(entry) === true)) {
        return false;
    }

    return true;
}

function make_unlabeled_tagged_cell_value(input: TaggedCellValue): LabeledTaggedCellValue {
    return {
        value: input,
        labels: []
    };
}

type LabeledTaggedCellValue = {
    value: TaggedCellValue,
    labels: string[]
}

type TaggedCellValuesORLabeledTaggedCellValues = TaggedCellValue | TaggedCellValue[] | LabeledTaggedCellValue | LabeledTaggedCellValue[];

function cast_to_labeled_tagged_cell_values(input: TaggedCellValuesORLabeledTaggedCellValues): LabeledTaggedCellValue | LabeledTaggedCellValue[] {

    if (is_tagged_cell_value_array(input)) {
        return input.map((entry) => make_unlabeled_tagged_cell_value(entry));
    } else if (is_tagged_cell_value(input)) {
        return make_unlabeled_tagged_cell_value(input);
    }

    return input;
}

interface ICellArrayPropertyBuilder {
    with_tagged_values: (first: TaggedCellValuesORLabeledTaggedCellValues, ...rest: TaggedCellValuesORLabeledTaggedCellValues[]) => INameBuilder;
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

    with_value(first: StringsORLabeledStrings, ...rest: StringsORLabeledStrings[]): INameBuilder {
        const flattened_rest = rest.flat();
        const normalized_value = first === undefined ? flattened_rest : (Array.isArray(first) ? [...first, ...flattened_rest] : [first, ...flattened_rest]);

        this.property.value = {
            components: []
        };

        for (const entry of normalized_value) {
            if (typeof entry === 'string') {
                this.property.value.components.push({
                    kind: "string",
                    value: entry,
                    labels: []
                });
            } else {
                this.property.value.components.push({
                    kind: "string",
                    value: entry.value,
                    labels: entry.labels
                });
            }
        }

        return this;
    }

    with_label(label: StringORLabeledString): INameBuilder {
        this.property.value = typeof label === 'string' ? {
            components: [{
                kind: "ref",
                labels: [],
                ref: {
                    kind: 'label',
                    name: label
                }
            }]
        } : {
            components: [{
                kind: "ref",
                labels: label.labels,
                ref: {
                    kind: 'label',
                    name: label.value
                }
            }]
        };

        return this;
    }

    with_path(path: StringORLabeledString): INameBuilder {
        this.property.value = typeof path === 'string' ? {
            components: [{
                kind: "ref",
                labels: [],
                ref: {
                    kind: 'path',
                    path: path
                }
            }]
        } : {
            components: [{
                kind: "ref",
                labels: path.labels,
                ref: {
                    kind: 'path',
                    path: path.value
                }
            }]
        };

        return this;
    }

    with_tagged_values(first: TaggedCellValuesORLabeledTaggedCellValues, ...rest: TaggedCellValuesORLabeledTaggedCellValues[]): INameBuilder {

        const tagged_to_element = (entry: LabeledTaggedCellValue): CellArrayElement => {
            switch (entry.value._tag) {
                case "number": {
                    return { item: { kind: "number", value: entry.value.value, labels: entry.labels } };
                }
                case "u64": {
                    return { item: { kind: "u64", value: entry.value.value, labels: entry.labels } };
                }
                case "label": {
                    return { item: { kind: "ref", labels: entry.labels, ref: { kind: "label", name: entry.value.value } } };
                }
                case "path": {
                    return { item: { kind: "ref", labels: entry.labels, ref: { kind: "path", path: entry.value.value } } };
                }
                case "expression": {
                    return { item: { kind: "expression", labels: entry.labels, value: entry.value.value } };
                }
                default: {
                    const _x: never = entry.value;
                    throw new Error("Exhaustive check failed!");
                }
            }
        };

        const make_cell_array = (values: LabeledTaggedCellValue[]): DtsCellArray => ({
            kind: "array",
            labels: [],
            elements: values.map((v) => tagged_to_element(v)),
        });

        const is_not_2d = (array: (LabeledTaggedCellValue | LabeledTaggedCellValue[])[]): array is LabeledTaggedCellValue[] => {
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

        const normalized_first = cast_to_labeled_tagged_cell_values(first);
        const normalized_rest = rest.map((entry) => cast_to_labeled_tagged_cell_values(entry));

        // needs type inference
        if (rest_array_count === 0 && is_not_2d(normalized_rest)) {
            // Single component mode: flatten first + rest into one component
            const normalized_values = (Array.isArray(normalized_first) ? [...normalized_first, ...normalized_rest] : [normalized_first, ...normalized_rest]);

            this.property.value = {
                components: [make_cell_array(normalized_values)]
            };
        } else if (!Array.isArray(normalized_first) && rest_array_count === 1) {

            const normalized_values: LabeledTaggedCellValue[] = [normalized_first];

            for (const entry of normalized_rest) {
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
            const all_arguments: (LabeledTaggedCellValue | LabeledTaggedCellValue[])[] = [normalized_first, ...normalized_rest];
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
            .with_labels(expected_compatible.labels)
            .with_user_modifications(expected_compatible.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Labeled String Builder`, () => {

        const string_value: LabeledString = {
            value: "adi,ad7124",
            labels: ["my_compat"]
        };

        const expected_compatible: DtsProperty = {
            labels: [],
            name: "compatible",
            value: {
                components: [
                    {
                        kind: 'string',
                        value: string_value.value,
                        labels: string_value.labels
                    }
                ]
            },
            deleted: false,
            modified_by_user: false
        };

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(string_value)
            .with_name(expected_compatible.name)
            .with_labels(expected_compatible.labels)
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
            .with_labels(expected_compatible.labels)
            .with_user_modifications(expected_compatible.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Labeled Array String Builder`, () => {
        const string_values: LabeledString[] = [
            {
                value: "adi,ad7124",
                labels: ["my_cool_label"]
            },
            {
                value: "adi,adxl355",
                labels: ["my_lame_label"]
            }
        ];

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
                    labels: entry.labels,
                    value: entry.value
                }
            );
        }

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(string_values)
            .with_name(expected_compatible.name)
            .with_labels(expected_compatible.labels)
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
            .with_labels(expected_compatible.labels)
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

    test(`Labeled Reference with label Builder`, () => {

        const label_name: LabeledString = {
            value: "gpio0",
            labels: ["useless_label"]
        };

        const expected_label_reference: DtsProperty = {
            labels: [],
            name: "gpio0",
            value: {
                components: [
                    {
                        kind: "ref",
                        labels: label_name.labels,
                        ref: {
                            kind: "label",
                            name: label_name.value
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

    test(`Labeled Reference with path Builder`, () => {
        const path: LabeledString = {
            value: "/soc/gpio",
            labels: ["doubtful_label"]
        };

        const expected_path_reference: DtsProperty = {
            labels: [],
            name: "gpio0",
            value: {
                components: [
                    {
                        kind: "ref",
                        labels: path.labels,
                        ref: {
                            kind: "path",
                            path: path.value
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

    test(`Labeled Cell Array Builder All Types Array`, () => {

        const values: LabeledTaggedCellValue[] = [
            {
                value: PropertyBuilder.tag_number(0),
                labels: ["insane_label"]
            },
            {
                value: PropertyBuilder.tag_u64(0),
                labels: ["insane_label"]
            },
            {
                value: PropertyBuilder.tag_label("gpio0"),
                labels: ["insane_label"]
            },
            {
                value: PropertyBuilder.tag_path("/soc/gpio0"),
                labels: ["insane_label"]
            },
            {
                value: PropertyBuilder.tag_expression("(1+1)"),
                labels: ["insane_label"]
            },
        ];

        const cell_array: DtsCellArray = {
            kind: "array",
            labels: [],
            elements: []
        };

        for (const entry of values) {

            switch (entry.value._tag) {
                case "number":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "number",
                                labels: entry.labels,
                                value: entry.value.value
                            }
                        });
                        break;
                    }
                case "u64":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "u64",
                                labels: entry.labels,
                                value: entry.value.value
                            }
                        });
                        break;
                    }
                case "label":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "ref",
                                labels: entry.labels,
                                ref: {
                                    kind: "label",
                                    name: entry.value.value
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
                                labels: entry.labels,
                                ref: {
                                    kind: "path",
                                    path: entry.value.value
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
                                labels: entry.labels,
                                value: entry.value.value
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