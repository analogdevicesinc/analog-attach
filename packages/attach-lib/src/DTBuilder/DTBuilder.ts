import { Bits, DTCellArray, DTNode, DTProperty } from "../dts";
import { print_property } from "../dts/printer";
import {
    CellArray,
    CellEntry,
    CellMatrix,
    CellValue,
    DTCellArrayInput,
    DTSReferenceInput,
    DTStringInput,
    is_cell_array,
    is_cell_array_or_cell_matrix,
    is_cell_entry_or_cell_array,
    LabeledDTString,
    LabeledTaggedCellValue,
    make_cell_array,
    upcast_to_LabeledDTString,
    upcast_to_LabeledDTStringArray,
    upcast_to_LabeledTaggedCellValue_LabeledArray
} from "./Types";
import { AddCallOnce, make_labeled_iterable } from "./TypeUtilities";

interface IFlagPropertyBuilder {
    set_flag(): IPropertyNameBuilder;
}

interface IStringPropertyBuilder {
    with_value<T extends DTStringInput[]>(...arguments_: [DTStringInput, ...T]): IPropertyNameBuilder;
}

interface IReferencePropertyBuilder {
    with_label_value(label: DTSReferenceInput): IPropertyNameBuilder;
    with_path_value(path: DTSReferenceInput): IPropertyNameBuilder;
}

interface ICellArrayPropertyBuilder {
    with_tagged_values<T extends CellEntry[]>(...arguments_: [CellEntry, ...T]): IPropertyNameBuilder;
    with_tagged_values<T extends CellEntry[]>(...arguments_: [...T, CellEntry, CellArray]): IPropertyNameBuilder;
    with_tagged_values<T extends CellEntry[]>(...arguments_: [CellArray, CellEntry, ...T]): IPropertyNameBuilder;
    with_tagged_values<T extends (CellArray | CellMatrix)[]>(...arguments_: [CellArray, ...T]): IPropertyNameBuilder;
    with_tagged_values<T extends (CellArray | CellMatrix)[]>(...arguments_: [CellMatrix, ...T]): IPropertyNameBuilder;
}

interface IPropertyNameBuilder {
    with_name(name: string): IPropertyBuild;
}

interface IPropertyBuildBase {
    build(): DTProperty;
}

interface IPropertyBuildCallOnce {
    with_label: (labels: string | string[]) => void;
};

type IPropertyBuild = AddCallOnce<IPropertyBuildBase, IPropertyBuildCallOnce>;

export class PropertyBuilder implements
    IFlagPropertyBuilder,
    IStringPropertyBuilder,
    IReferencePropertyBuilder,
    ICellArrayPropertyBuilder,
    IPropertyNameBuilder,
    IPropertyBuild {

    private property: DTProperty = {
        labels: [],
        name: "",
        value: [],
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

    set_flag(): IPropertyNameBuilder {
        this.property.value = { kind: "flag" };
        return this;
    }

    with_value(...arguments_: DTStringInput[]): IPropertyNameBuilder {
        const upcast = arguments_.map((entry) => upcast_to_LabeledDTStringArray(entry));

        const normalized_value = upcast.flat();

        this.property.value = [];

        for (const entry of normalized_value) {
            this.property.value.push({
                kind: "string",
                value: entry.payload,
                labels: entry.labels
            });
        }

        return this;
    }

    with_label_value(label: DTSReferenceInput): IPropertyNameBuilder {
        const upcast = upcast_to_LabeledDTString(label);

        this.property.value = [
            {
                kind: 'label',
                labels: upcast.labels,
                name: upcast.payload
            }
        ];

        return this;
    }

    with_path_value(path: DTSReferenceInput): IPropertyNameBuilder {
        const upcast = upcast_to_LabeledDTString(path);

        this.property.value = [
            {
                kind: 'path',
                labels: upcast.labels,
                path: upcast.payload
            }
        ];

        return this;
    }

    with_tagged_values(...arguments_: DTCellArrayInput[]): IPropertyNameBuilder {
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

            this.property.value = [make_cell_array(merged)];
        }

        if (arguments_.every((entry) => is_cell_array_or_cell_matrix(entry) === true)) {

            const upcast = arguments_.map(
                (entry) => is_cell_array(entry) ?
                    upcast_to_LabeledTaggedCellValue_LabeledArray(entry) :
                    entry.map((row) => upcast_to_LabeledTaggedCellValue_LabeledArray(row))
            );

            this.property.value = upcast.flat().map((entry) => make_cell_array(entry));
        }

        return this;
    }

    with_name(name: string): IPropertyBuild {
        this.property.name = name;
        return this;
    }

    with_label(labels: string | string[]): IPropertyBuild {
        this.property.labels = Array.isArray(labels) ? labels : [labels];
        return this;
    }

    build(): DTProperty {
        return this.property;
    }

    static to_string(property: DTProperty): string {
        return print_property(property, "", 0);
    }

    static tag_number(value: number | bigint) { return { _tag: "number" as const, value: BigInt(value) }; };
    static tag_label(value: string) { return { _tag: "label" as const, value: value }; };
    static tag_path(value: string) { return { _tag: "path" as const, value: value }; };
    static tag_expression(value: string) { return { _tag: "expression" as const, value: value }; };
}

interface INodeNameBuilder {
    with_name: (name: string) => INodeBuilder;
}

export interface INodeBuilderBase {
    build: () => DTNode;
}

interface INodeBuilderCallOnce {
    with_label: (label: string | string[]) => void;
    with_unit_address: (unit_address: string) => void;
    with_properties: (properties: DTProperty | DTProperty[]) => void;
    with_children: (children: INodeBuilderBase | INodeBuilderBase[]) => void;
}

type INodeBuilder = AddCallOnce<INodeBuilderBase, INodeBuilderCallOnce>;

export class NodeBuilder implements INodeNameBuilder, INodeBuilder {

    private node: DTNode = {
        labels: [],
        name: "",
        unit_addr: undefined,
        properties: [],
        children: [],
    };

    private constructor() { }

    static new(): INodeNameBuilder {
        return new NodeBuilder;
    }

    build(): DTNode {
        return this.node;
    }

    with_label(label: string | string[]): INodeBuilder {
        this.node.labels = Array.isArray(label) ? label : [label];
        return this;
    }

    with_name(name: string): INodeBuilder {
        this.node.name = name;
        return this;
    }

    with_unit_address(unit_address: string): INodeBuilder {
        this.node.unit_addr = unit_address;
        return this;
    }

    with_properties(properties: DTProperty | DTProperty[]): INodeBuilder {
        this.node.properties = Array.isArray(properties) ? properties : [properties];
        return this;
    }

    with_children(children: INodeBuilderBase | INodeBuilderBase[]): INodeBuilder {
        const childArray = Array.isArray(children) ? children : [children];
        this.node.children = childArray.map(child => child.build());
        return this;
    }
}

if (import.meta.vitest !== undefined) {

    const { test, expect } = import.meta.vitest;

    test(`Flag Builder`, () => {
        const expected_flag: DTProperty = {
            labels: [],
            name: "spi-controller",
            value: { kind: "flag" },
        };

        const flag: DTProperty = PropertyBuilder.build_flag()
            .set_flag()
            .with_name(expected_flag.name)
            .with_label(expected_flag.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(flag)}`);

        expect(flag).toStrictEqual(expected_flag);
    });

    test(`String Builder`, () => {
        const string_value: string = "adi,ad7124";

        const expected_compatible: DTProperty = {
            labels: [],
            name: "compatible",
            value: [
                {
                    kind: 'string',
                    value: string_value,
                    labels: []
                }
            ]
        };

        const compatible: DTProperty = PropertyBuilder.build_string()
            .with_value(string_value)
            .with_name(expected_compatible.name)
            .with_label(expected_compatible.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Labeled String Builder`, () => {
        const string_value: LabeledDTString = {
            payload: "adi,ad7124",
            labels: ["my_compat"]
        };

        const expected_compatible: DTProperty = {
            labels: [],
            name: "compatible",
            value: [
                {
                    kind: 'string',
                    value: string_value.payload,
                    labels: string_value.labels
                }
            ]
        };

        const compatible: DTProperty = PropertyBuilder.build_string()
            .with_value(string_value)
            .with_name(expected_compatible.name)
            .with_label(expected_compatible.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Array String Builder`, () => {
        const string_values: string[] = ["adi,ad7124", "adi,adxl355"];

        const expected_compatible: DTProperty = {
            labels: [],
            name: "compatible",
            value: string_values.map((entry) => {
                return {
                    kind: 'string',
                    labels: [],
                    value: entry
                };
            })
        };

        const compatible: DTProperty = PropertyBuilder.build_string()
            .with_value(string_values)
            .with_name(expected_compatible.name)
            .with_label(expected_compatible.labels)
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

        const expected_compatible: DTProperty = {
            labels: [],
            name: "compatible",
            value: string_values.map((entry) => {
                return {
                    kind: 'string',
                    labels: entry.labels,
                    value: entry.payload
                };
            })
        };

        const compatible: DTProperty = PropertyBuilder.build_string()
            .with_value(string_values)
            .with_name(expected_compatible.name)
            .with_label(expected_compatible.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Variadic String Builder`, () => {
        const string1_value: string = "adi,ad7124";
        const string2_value: string = "adi,adxl355";

        const expected_compatible: DTProperty = {
            labels: [],
            name: "compatible",
            value:
                [
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
        };

        const compatible: DTProperty = PropertyBuilder.build_string()
            .with_value(string1_value, string2_value)
            .with_name(expected_compatible.name)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Variadic String Array Builder`, () => {
        const string1_values: string[] = ["adi,ad7124-4", "adi,ad7124-8"];
        const string2_values: string[] = ["adi,adxl355"];

        const composed = [...string1_values, ...string2_values];

        const expected_compatible: DTProperty = {
            labels: [],
            name: "compatible",
            value: composed.map((entry) => {
                return {
                    kind: 'string',
                    labels: [],
                    value: entry
                };
            })
        };

        const compatible: DTProperty = PropertyBuilder.build_string()
            .with_value(string1_values, string2_values)
            .with_name(expected_compatible.name)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Variadic String Array and String Builder 1`, () => {
        const string1_values: string[] = ["adi,ad7124-4", "adi,ad7124-8"];
        const string2_value: string = "adi,adxl355";

        const composed = [...string1_values, string2_value];

        const expected_compatible: DTProperty = {
            labels: [],
            name: "compatible",
            value: composed.map((entry) => {
                return {
                    kind: 'string',
                    labels: [],
                    value: entry
                };
            })
        };

        const compatible: DTProperty = PropertyBuilder.build_string()
            .with_value(string1_values, string2_value)
            .with_name(expected_compatible.name)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Variadic String Array and String Builder 2`, () => {
        const string1_values: string = "adi,ad7124-4";
        const string2_value: string[] = ["adi,adxl355", "adi,ad7124-8"];

        const composed = [string1_values, ...string2_value];

        const expected_compatible: DTProperty = {
            labels: [],
            name: "compatible",
            value: composed.map((entry) => {
                return {

                    kind: 'string',
                    labels: [],
                    value: entry
                };
            })
        };

        const compatible: DTProperty = PropertyBuilder.build_string()
            .with_value(string1_values, string2_value)
            .with_name(expected_compatible.name)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Variadic String Array and String Builder 3`, () => {
        const string1_values: string[] = ["adi,ad7124-4"];
        const string2_value: string = "adi,ad7124-8";
        const string3_values: string[] = ["adi,adxl355"];

        const composed = [...string1_values, string2_value, ...string3_values];

        const expected_compatible: DTProperty = {
            labels: [],
            name: "compatible",
            value: composed.map((entry) => {
                return {
                    kind: 'string',
                    labels: [],
                    value: entry
                };
            })
        };

        const compatible: DTProperty = PropertyBuilder.build_string()
            .with_value(string1_values, string2_value, string3_values)
            .with_name(expected_compatible.name)
            .with_label(expected_compatible.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);
        expect(compatible).toStrictEqual(expected_compatible);
    });

    test(`Reference with label Builder`, () => {
        const label_name: string = "gpio";

        const expected_label_reference: DTProperty = {
            labels: [],
            name: "gpio0",
            value: [
                {
                    kind: "label",
                    labels: [],
                    name: label_name
                }
            ]
        };

        const label_reference: DTProperty = PropertyBuilder.build_reference()
            .with_label_value(label_name)
            .with_name(expected_label_reference.name)
            .build();

        console.log(`${PropertyBuilder.to_string(label_reference)}`);
        expect(label_reference).toStrictEqual(expected_label_reference);
    });

    test(`Labeled Reference with label Builder`, () => {
        const label_name: LabeledDTString = {
            payload: "gpio0",
            labels: ["useless_label"]
        };

        const expected_label_reference: DTProperty = {
            labels: [],
            name: "gpio0",
            value: [
                {
                    kind: "label",
                    labels: label_name.labels,
                    name: label_name.payload
                }
            ]
        };

        const label_reference: DTProperty = PropertyBuilder.build_reference()
            .with_label_value(label_name)
            .with_name(expected_label_reference.name)
            .with_label(expected_label_reference.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(label_reference)}`);
        expect(label_reference).toStrictEqual(expected_label_reference);
    });

    test(`Reference with path Builder`, () => {
        const path: string = "/soc/gpio";

        const expected_path_reference: DTProperty = {
            labels: [],
            name: "gpio0",
            value: [
                {
                    kind: "path",
                    labels: [],
                    path: path
                }
            ]
        };

        const path_reference: DTProperty = PropertyBuilder.build_reference()
            .with_path_value(path)
            .with_name(expected_path_reference.name)
            .with_label(expected_path_reference.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(path_reference)}`);
        expect(path_reference).toStrictEqual(expected_path_reference);
    });

    test(`Labeled Reference with path Builder`, () => {
        const path: LabeledDTString = {
            payload: "/soc/gpio",
            labels: ["doubtful_label"]
        };

        const expected_path_reference: DTProperty = {
            labels: [],
            name: "gpio0",
            value: [
                {
                    kind: "path",
                    labels: path.labels,
                    path: path.payload
                }
            ]
        };

        const path_reference: DTProperty = PropertyBuilder.build_reference()
            .with_path_value(path)
            .with_name(expected_path_reference.name)
            .with_label(expected_path_reference.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(path_reference)}`);
        expect(path_reference).toStrictEqual(expected_path_reference);
    });

    test(`Cell Array Builder : (...CellEntry[>=1])`, () => {
        const number_value = PropertyBuilder.tag_number(0);
        const label_value = PropertyBuilder.tag_label("gpio0");
        const path_value = PropertyBuilder.tag_path("/soc/gpio0");
        const expression_value = PropertyBuilder.tag_expression("(1+1)");

        const composed = [[number_value, label_value, path_value, expression_value]];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(
                PropertyBuilder.tag_number(0),
                PropertyBuilder.tag_label("gpio0"),
                PropertyBuilder.tag_path("/soc/gpio0"),
                PropertyBuilder.tag_expression("(1+1)")
            )
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (CellArray)`, () => {
        const values: CellValue[] = [
            PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)"),
        ];

        const composed = [values];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
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

        const composed = [values];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (...CellEntry[>=1], CellArray)`, () => {
        const value: CellValue = PropertyBuilder.tag_number(0);

        const values: CellValue[] = [
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)"),
        ];

        const composed = [[value, ...values]];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(value, values)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (CellArray, ...CellEntry[>=1])`, () => {
        const value: CellValue = PropertyBuilder.tag_number(0);

        const values: CellValue[] = [
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)"),
        ];

        const composed = [[...values, value]];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values, value)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`FAIL Cell Array Builder : (...CellEntry[>=1], CellArray, ...CellEntry[>=1])`, () => {
        const value1: CellValue = PropertyBuilder.tag_number(0);

        const values: CellValue[] = [
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
            PropertyBuilder.tag_label("gpio0"),
            PropertyBuilder.tag_path("/soc/gpio0"),
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_expression("(1+1)")
        ];

        const composed: CellValue[][] = [values1, values2];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values1, values2)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`FAIL Cell Array Builder : (...CellArray[>=2], ...CellEntry[>=1])`, () => {
        const values1: CellValue[] = [
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
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const composed = values;

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (...CellMatrix[>=1])`, () => {
        const values: CellValue[][] = [
            [PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const values2: CellValue[][] = [
            [PropertyBuilder.tag_number(1),
            PropertyBuilder.tag_label("gpio1")],
            [PropertyBuilder.tag_path("/soc/gpio1"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const composed = [...values, ...values2];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values, values2)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (CellMatrix, CellArray)`, () => {
        const values: CellValue[][] = [
            [PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_number(1),
            PropertyBuilder.tag_label("gpio1")
        ];

        const composed = [...values, [...values2]];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values, values2)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (CellArray, CellMatrix)`, () => {
        const values: CellValue[][] = [
            [PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_number(1),
            PropertyBuilder.tag_label("gpio1")
        ];

        const composed = [[...values2], ...values];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values2, values)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    test(`Cell Array Builder : (CellMatrix, ...(CellArray,CellMatrix)[>=1])`, () => {
        const values: CellValue[][] = [
            [PropertyBuilder.tag_number(0),
            PropertyBuilder.tag_label("gpio0")],
            [PropertyBuilder.tag_path("/soc/gpio0"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const values2: CellValue[] = [
            PropertyBuilder.tag_number(1),
            PropertyBuilder.tag_label("gpio1")
        ];

        const values3: CellValue[][] = [
            [PropertyBuilder.tag_number(2),
            PropertyBuilder.tag_label("gpio2")],
            [PropertyBuilder.tag_path("/soc/gpio2"),
            PropertyBuilder.tag_expression("(1+1)")],
        ];

        const composed = [...values, [...values2], ...values3];

        const expected_cell: DTProperty = {
            labels: [],
            name: "unusual-cell",
            value: cell_value_matrix_to_dts_cell_array_array(composed)
        };

        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(values, values2, values3)
            .with_name(expected_cell.name)
            .with_label(expected_cell.labels)
            .build();

        console.log(`${PropertyBuilder.to_string(cell)}`);
        expect(cell).toStrictEqual(expected_cell);
    });

    function cell_value_matrix_to_dts_cell_array_array(input: CellMatrix): DTCellArray[] {
        const cell_array_array: DTCellArray[] = [];

        const upcast = input.map((entry) => upcast_to_LabeledTaggedCellValue_LabeledArray(entry));

        for (const entry of upcast) {
            const cell_array: DTCellArray = {
                kind: "array",
                bit_width: Bits.b32,
                labels: [],
                elements: []
            };

            const iterable = make_labeled_iterable(entry);

            for (const sub_entry of iterable) {
                switch (sub_entry.payload._tag) {
                    case "number":
                        {
                            cell_array.elements.push({
                                kind: "number",
                                labels: sub_entry.labels,
                                value: sub_entry.payload.value,
                                repr: "dec"
                            });
                            break;
                        }
                    case "label":
                        {
                            cell_array.elements.push({
                                kind: "label",
                                labels: sub_entry.labels,
                                name: sub_entry.payload.value
                            });
                            break;
                        }
                    case "path":
                        {
                            cell_array.elements.push({
                                kind: "path",
                                labels: sub_entry.labels,
                                path: sub_entry.payload.value
                            });
                            break;
                        }
                    case "expression":
                        {
                            cell_array.elements.push({
                                kind: "expression",
                                labels: sub_entry.labels,
                                value: sub_entry.payload.value
                            });
                            break;
                        }
                }
            }
            cell_array_array.push(cell_array);
        }

        return cell_array_array;
    }
}