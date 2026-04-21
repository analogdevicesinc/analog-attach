import { DtsCellArray, DtsProperty } from "../dts";
import { print_property } from "../dts/printer";
import { CellArray, CellEntry, CellMatrix, CellValue, DTCellArrayInput, DTSReferenceInput, DTStringInput, is_cell_array, is_cell_array_or_cell_matrix, is_cell_entry, is_cell_entry_or_cell_array, is_cell_matrix, is_labeled_tagged_cell_value_labeled_array, LabeledDTString, LabeledTaggedCellValue, LabeledTaggedCellValue_LabeledArray, make_cell_array, upcast_to_LabeledDTString, upcast_to_LabeledDTStringArray, upcast_to_LabeledTaggedCellValue_LabeledArray } from "./Types";

interface IFlagPropertyBuilder {
    set_flag(): INameBuilder;
}

interface IStringPropertyBuilder {
    with_value<T extends [...DTStringInput[]]>(...arguments_: [DTStringInput, ...T]): INameBuilder;
}

interface IReferencePropertyBuilder {
    with_label(label: DTSReferenceInput): INameBuilder;
    with_path(path: DTSReferenceInput): INameBuilder;
}

interface ICellArrayPropertyBuilder {
    with_tagged_values<T extends [...CellEntry[]]>(...arguments_: [CellEntry, ...T]): INameBuilder;
    with_tagged_values<T extends [CellEntry, ...CellEntry[]]>(...arguments_: [...T, CellArray]): INameBuilder;
    with_tagged_values<T extends [CellEntry, ...CellEntry[]]>(...arguments_: [CellArray, ...T]): INameBuilder;
    with_tagged_values<T extends [...CellArray[]]>(...arguments_: [CellArray, ...T]): INameBuilder;
    with_tagged_values<T extends [CellMatrix, ...CellMatrix[]]>(...arguments_: [CellArray, ...T]): INameBuilder;
    with_tagged_values<T extends [(CellArray | CellMatrix), ...(CellArray | CellMatrix)[]]>(...arguments_: [CellArray, ...T]): INameBuilder;
    with_tagged_values<T extends [CellArray, ...CellArray[]]>(...arguments_: [CellMatrix, ...T]): INameBuilder;
    with_tagged_values<T extends [...CellMatrix[]]>(...arguments_: [CellMatrix, ...T]): INameBuilder;
    with_tagged_values<T extends [(CellArray | CellMatrix), ...(CellArray | CellMatrix)[]]>(...arguments_: [CellMatrix, ...T]): INameBuilder;
}

interface INameBuilder {
    with_name(name: string): IBuild;
}

interface IBuildBase {
    build(): DtsProperty;
}

type CallOnce = {
    with_labels: (labels: string[]) => void;
    with_user_modifications: (modified_by_user: boolean) => void;
};

type IBuild<Remaining extends keyof CallOnce = keyof CallOnce> =
    IBuildBase & {
        [K in Remaining]: (...arguments_: Parameters<CallOnce[K]>) => IBuild<Exclude<Remaining, K>>;
    };

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

    with_value(...arguments_: DTStringInput[]): INameBuilder {
        const upcast = arguments_.map((entry) => upcast_to_LabeledDTStringArray(entry));

        const normalized_value = upcast.flat();

        this.property.value = {
            components: []
        };

        for (const entry of normalized_value) {
            this.property.value.components.push({
                kind: "string",
                value: entry.payload,
                labels: entry.labels
            });
        }

        return this;
    }

    with_label(label: DTSReferenceInput): INameBuilder {
        const upcast = upcast_to_LabeledDTString(label);

        this.property.value = {
            components: [{
                kind: "ref",
                labels: upcast.labels,
                ref: {
                    kind: 'label',
                    name: upcast.payload
                }
            }]
        };

        return this;
    }

    with_path(path: DTSReferenceInput): INameBuilder {
        const upcast = upcast_to_LabeledDTString(path);

        this.property.value = {
            components: [{
                kind: "ref",
                labels: upcast.labels,
                ref: {
                    kind: 'path',
                    path: upcast.payload
                }
            }]
        };

        return this;
    }

    with_tagged_values(...arguments_: DTCellArrayInput[]): INameBuilder {

        if (
            arguments_.every((entry) => is_cell_entry_or_cell_array(entry) === true) &&
            arguments_.filter((element) => is_cell_array(element)).length <= 1
        ) {
            const upcast = arguments_.map((entry) => upcast_to_LabeledTaggedCellValue_LabeledArray(entry));

            // eslint-disable-next-line unicorn/no-array-reduce
            const merged = upcast.reduce((accumulator, current_value) => {
                accumulator.payload.push(...current_value.payload);
                accumulator.labels.push(...current_value.labels);
                return accumulator;
            });

            this.property.value = {
                components: [make_cell_array(merged)]
            };
        }

        if (arguments_.every((entry) => is_cell_array_or_cell_matrix(entry) === true)) {

            const upcast = arguments_.map(
                (entry) => is_cell_array(entry) ?
                    upcast_to_LabeledTaggedCellValue_LabeledArray(entry) :
                    entry.map((row) => upcast_to_LabeledTaggedCellValue_LabeledArray(row))
            );

            this.property.value = {
                components: upcast.flat().map(
                    (entry) => make_cell_array(entry))
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

        const string_value: LabeledDTString = {
            payload: "adi,ad7124",
            labels: ["my_compat"]
        };

        const expected_compatible: DtsProperty = {
            labels: [],
            name: "compatible",
            value: {
                components: [
                    {
                        kind: 'string',
                        value: string_value.payload,
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
        const string_values: LabeledDTString[] = [
            {
                payload: "adi,ad7124",
                labels: ["my_cool_label"]
            },
            {
                payload: "adi,adxl355",
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
                    value: entry.payload
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

        const label_name: LabeledDTString = {
            payload: "gpio0",
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
                            name: label_name.payload
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
        const path: LabeledDTString = {
            payload: "/soc/gpio",
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
                            path: path.payload
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

    test(`Cell Array Builder : (...CellEntry[>=1])`, () => {

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

    test(`Cell Array Builder : (CellArray)`, () => {

        const values: CellValue[] = [
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

    test(`Labeled Cell Array Builder : (CellArray)`, () => {

        const values: LabeledTaggedCellValue[] = [
            {
                payload: PropertyBuilder.tag_number(0),
                labels: ["insane_label"]
            },
            {
                payload: PropertyBuilder.tag_u64(0),
                labels: ["insane_label"]
            },
            {
                payload: PropertyBuilder.tag_label("gpio0"),
                labels: ["insane_label"]
            },
            {
                payload: PropertyBuilder.tag_path("/soc/gpio0"),
                labels: ["insane_label"]
            },
            {
                payload: PropertyBuilder.tag_expression("(1+1)"),
                labels: ["insane_label"]
            },
        ];

        const cell_array: DtsCellArray = {
            kind: "array",
            labels: [],
            elements: []
        };

        for (const entry of values) {

            switch (entry.payload._tag) {
                case "number":
                    {
                        cell_array.elements.push({
                            item: {
                                kind: "number",
                                labels: entry.labels,
                                value: entry.payload.value
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
                                value: entry.payload.value
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
                                    name: entry.payload.value
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
                                    path: entry.payload.value
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
                                value: entry.payload.value
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

    test(`Cell Array Builder : (...CellEntry[>=1], CellArray)`, () => {

        const value: CellValue = PropertyBuilder.tag_number(0);

        const values: CellValue[] = [
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

    test(`Cell Array Builder : (CellArray, ...CellEntry[>=1])`, () => {

        const value: CellValue = PropertyBuilder.tag_number(0);

        const values: CellValue[] = [
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

    test(`FAIL Cell Array Builder : (...CellEntry[>=1], CellArray, ...CellEntry[>=1])`, () => {
        const value1: CellValue = PropertyBuilder.tag_number(0);

        const values: CellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const value2: CellValue = PropertyBuilder.tag_expression("(1+1)");

        const _cell = PropertyBuilder.build_cell_array()
            // @ts-expect-error
            .with_tagged_values(value1, values, value2)
            .with_name("")
            .build();
    });

    test(`Cell Array Builder : (...CellArray[>=1])`, () => {
        const values1: CellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_expression("(1+1)")
        ];

        const composed: CellValue[][] = [values1, values2];

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

    test(`FAIL Cell Array Builder : (...CellArray[>=2], ...CellEntry[>=1])`, () => {
        const values1: CellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const value: CellValue = PropertyBuilder.tag_number(0);

        const _cell = PropertyBuilder.build_cell_array()
            // @ts-expect-error invalid combination
            .with_tagged_values(values1, values2, value)
            .with_name("")
            .build();
    });

    test(`FAIL Cell Array Builder : (...CellArray[>=1], ...CellEntry[>=1], ...CellArray[>=1])`, () => {
        const values1: CellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const value: CellValue = PropertyBuilder.tag_number(0);

        const cell = PropertyBuilder.build_cell_array()
            // @ts-expect-error invalid combination
            .with_tagged_values(values1, value, values2)
            .with_name("")
            .build();
    });

    test(`FAIL Cell Array Builder : (...CellEntry[>=1], ...CellArray[>=2])`, () => {
        const values1: CellValue[] = [
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const value: CellValue = PropertyBuilder.tag_number(0);

        const cell = PropertyBuilder.build_cell_array()
            // @ts-expect-error invalid combination
            .with_tagged_values(value, values1, values2)
            .with_name("")
            .build();
    });

    test(`Cell Array Builder : (CellMatrix)`, () => {
        const values: CellValue[][] = [
            [PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const cell_array_array: DtsCellArray[] = [];

        for (const entry of values) {
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
            .with_tagged_values(values)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (...CellMatrix[>=1])`, () => {
        const values: CellValue[][] = [
            [PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const values2: CellValue[][] = [
            [PropertyBuilder.tag_number(1),
            PropertyBuilder.tag_u64(1),
            PropertyBuilder.tag_label("gpio1")],
            [PropertyBuilder.tag_path("/soc/gpio1"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const composed = [...values, ...values2];

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
            .with_tagged_values(values, values2)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (CellMatrix, CellArray)`, () => {
        const values: CellValue[][] = [
            [PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_number(1),
            PropertyBuilder.tag_u64(1),
            PropertyBuilder.tag_label("gpio1")
        ];

        const composed = [...values, [...values2]];

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
            .with_tagged_values(values, values2)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (CellArray, CellMatrix)`, () => {
        const values: CellValue[][] = [
            [PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_number(1),
            PropertyBuilder.tag_u64(1),
            PropertyBuilder.tag_label("gpio1")
        ];

        const composed = [[...values2], ...values];

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
            .with_tagged_values(values2, values)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (CellMatrix, ...(CellArray,CellMatrix)[>=1])`, () => {
        const values: CellValue[][] = [
            [PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_u64(0),
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_number(1),
            PropertyBuilder.tag_u64(1),
            PropertyBuilder.tag_label("gpio1")
        ];

        const values3: CellValue[][] = [
            [PropertyBuilder.tag_number(2),
            PropertyBuilder.tag_u64(2),
            PropertyBuilder.tag_label("gpio2")],
            [PropertyBuilder.tag_path("/soc/gpio2"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const composed = [...values, [...values2], ...values3];

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
            .with_tagged_values(values, values2, values3)
            .with_name(expected_cell.name)
            .with_labels(expected_cell.labels)
            .with_user_modifications(expected_cell.modified_by_user)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });
}