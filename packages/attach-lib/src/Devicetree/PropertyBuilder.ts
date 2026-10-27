import { DTProperty, is_dt_flag } from "./Parser";
import { print_property } from "./Parser";
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
    make_cell_array,
    NumberRepr,
    upcast_to_LabeledDTString,
    upcast_to_LabeledDTStringArray,
    upcast_to_LabeledTaggedCellValue_LabeledArray
} from "./Types";
import { AddCallOnce } from "./TypeUtilities";

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

    /** A number cell, printed in decimal unless `repr` says hex (as the parser keeps a `0x…` literal). */
    static tag_number(value: number | bigint, repr?: NumberRepr) {
        return { _tag: "number" as const, value: BigInt(value), ...(repr === undefined ? {} : { repr }) };
    };
    static tag_label(value: string) { return { _tag: "label" as const, value: value }; };
    static tag_path(value: string) { return { _tag: "path" as const, value: value }; };
    static tag_expression(value: string) { return { _tag: "expression" as const, value: value }; };
}

if (import.meta.vitest !== undefined) {

    const { test, expect } = import.meta.vitest;

    const number = PropertyBuilder.tag_number;
    const label = PropertyBuilder.tag_label;
    const path = PropertyBuilder.tag_path;
    const expression = PropertyBuilder.tag_expression;
    const labeled = <T>(payload: T, labels: string[]) => ({ payload, labels });

    const row: CellValue[] = [number(0), label("gpio0"), path("/soc/gpio0"), expression("(1+1)")];
    const matrix = (index: number): CellValue[][] => [[number(index), label(`gpio${index}`)], [path(`/soc/gpio${index}`), expression("(1+1)")]];
    const pair = (index: number): CellValue[] => [number(index), label(`gpio${index}`)];

    // What each way of giving a builder its values prints: a property is written as the overlay will hold it
    test.each<[string, () => DTProperty, string]>([
        ["flag", () => PropertyBuilder.build_flag().set_flag().with_name("spi-controller").build(), "spi-controller;"],
        ["string", () => PropertyBuilder.build_string().with_value("adi,ad7124").with_name("compatible").build(), `compatible = "adi,ad7124";`],
        ["labelled string", () => PropertyBuilder.build_string().with_value(labeled("adi,ad7124", ["my_compat"])).with_name("compatible").build(), `compatible = my_compat: "adi,ad7124";`],
        ["string array", () => PropertyBuilder.build_string().with_value(["adi,ad7124", "adi,adxl355"]).with_name("compatible").build(), `compatible = "adi,ad7124", "adi,adxl355";`],
        [
            "labelled string array",
            () => PropertyBuilder.build_string().with_value([labeled("adi,ad7124", ["a"]), labeled("adi,adxl355", ["b"])]).with_name("compatible").build(),
            `compatible = a: "adi,ad7124", b: "adi,adxl355";`,
        ],
        ["strings", () => PropertyBuilder.build_string().with_value("adi,ad7124", "adi,adxl355").with_name("compatible").build(), `compatible = "adi,ad7124", "adi,adxl355";`],
        [
            "string arrays",
            () => PropertyBuilder.build_string().with_value(["adi,ad7124-4", "adi,ad7124-8"], ["adi,adxl355"]).with_name("compatible").build(),
            `compatible = "adi,ad7124-4", "adi,ad7124-8", "adi,adxl355";`,
        ],
        [
            "a string array, then a string",
            () => PropertyBuilder.build_string().with_value(["adi,ad7124-4", "adi,ad7124-8"], "adi,adxl355").with_name("compatible").build(),
            `compatible = "adi,ad7124-4", "adi,ad7124-8", "adi,adxl355";`,
        ],
        [
            "a string, then a string array",
            () => PropertyBuilder.build_string().with_value("adi,ad7124-4", ["adi,adxl355", "adi,ad7124-8"]).with_name("compatible").build(),
            `compatible = "adi,ad7124-4", "adi,adxl355", "adi,ad7124-8";`,
        ],
        [
            "a string between string arrays",
            () => PropertyBuilder.build_string().with_value(["adi,ad7124-4"], "adi,ad7124-8", ["adi,adxl355"]).with_name("compatible").build(),
            `compatible = "adi,ad7124-4", "adi,ad7124-8", "adi,adxl355";`,
        ],
        ["label reference", () => PropertyBuilder.build_reference().with_label_value("gpio").with_name("gpio0").build(), "gpio0 = &gpio;"],
        ["labelled label reference", () => PropertyBuilder.build_reference().with_label_value(labeled("gpio0", ["a"])).with_name("gpio0").build(), "gpio0 = a: &gpio0;"],
        ["path reference", () => PropertyBuilder.build_reference().with_path_value("/soc/gpio").with_name("gpio0").build(), "gpio0 = &{/soc/gpio};"],
        ["labelled path reference", () => PropertyBuilder.build_reference().with_path_value(labeled("/soc/gpio", ["a"])).with_name("gpio0").build(), "gpio0 = a: &{/soc/gpio};"],
        ["cells", () => PropertyBuilder.build_cell_array().with_tagged_values(number(0), label("gpio0"), path("/soc/gpio0"), expression("(1+1)")).with_name("cells").build(), "cells = <0 &gpio0 &{/soc/gpio0} (1+1)>;"],
        ["a cell array", () => PropertyBuilder.build_cell_array().with_tagged_values(row).with_name("cells").build(), "cells = <0 &gpio0 &{/soc/gpio0} (1+1)>;"],
        [
            "a labelled cell array",
            () => PropertyBuilder.build_cell_array().with_tagged_values(row.map(cell => labeled(cell, ["a"]))).with_name("cells").build(),
            "cells = <a: 0 a: &gpio0 a: &{/soc/gpio0} a: (1+1)>;",
        ],
        ["a cell, then a cell array", () => PropertyBuilder.build_cell_array().with_tagged_values(row[0]!, row.slice(1)).with_name("cells").build(), "cells = <0 &gpio0 &{/soc/gpio0} (1+1)>;"],
        ["a cell array, then a cell", () => PropertyBuilder.build_cell_array().with_tagged_values(row.slice(1), row[0]!).with_name("cells").build(), "cells = <&gpio0 &{/soc/gpio0} (1+1) 0>;"],
        ["cell arrays", () => PropertyBuilder.build_cell_array().with_tagged_values(row.slice(1, 3), [row[0]!, row[3]!]).with_name("cells").build(), "cells = <&gpio0 &{/soc/gpio0}>, <0 (1+1)>;"],
        ["a matrix", () => PropertyBuilder.build_cell_array().with_tagged_values(matrix(0)).with_name("cells").build(), "cells = <0 &gpio0>, <&{/soc/gpio0} (1+1)>;"],
        [
            "matrices",
            () => PropertyBuilder.build_cell_array().with_tagged_values(matrix(0), matrix(1)).with_name("cells").build(),
            "cells = <0 &gpio0>, <&{/soc/gpio0} (1+1)>, <1 &gpio1>, <&{/soc/gpio1} (1+1)>;",
        ],
        ["a matrix, then a cell array", () => PropertyBuilder.build_cell_array().with_tagged_values(matrix(0), pair(1)).with_name("cells").build(), "cells = <0 &gpio0>, <&{/soc/gpio0} (1+1)>, <1 &gpio1>;"],
        ["a cell array, then a matrix", () => PropertyBuilder.build_cell_array().with_tagged_values(pair(1), matrix(0)).with_name("cells").build(), "cells = <1 &gpio1>, <0 &gpio0>, <&{/soc/gpio0} (1+1)>;"],
        [
            "matrices and cell arrays",
            () => PropertyBuilder.build_cell_array().with_tagged_values(matrix(0), pair(1), matrix(2)).with_name("cells").build(),
            "cells = <0 &gpio0>, <&{/soc/gpio0} (1+1)>, <1 &gpio1>, <2 &gpio2>, <&{/soc/gpio2} (1+1)>;",
        ],
    ])("%s", (_name, build, printed) => {
        expect(PropertyBuilder.to_string(build())).toBe(`${printed}\n`);
    });

    // The assertions are the @ts-expect-errors, checked by `yarn typecheck`: loose cells may only come before or after
    // one cell array, the cells of its row
    test("cell arrays can't be mixed with loose cells", () => {
        const cells = PropertyBuilder.build_cell_array();
        // @ts-expect-error a cell array between cells
        cells.with_tagged_values(number(0), pair(1), number(2));
        // @ts-expect-error a cell after cell arrays
        cells.with_tagged_values(pair(1), pair(2), number(0));
        // @ts-expect-error a cell between cell arrays
        cells.with_tagged_values(pair(1), number(0), pair(2));
        // @ts-expect-error a cell before cell arrays
        cells.with_tagged_values(number(0), pair(1), pair(2));
    });

    test("tag_number — a hex repr is kept and printed, decimal is the default", () => {
        expect(PropertyBuilder.tag_number(5)).toStrictEqual({ _tag: "number", value: 5n });
        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values(PropertyBuilder.tag_number(0x2An, "hex"), PropertyBuilder.tag_number(5))
            .with_name("reg")
            .build();
        const [array] = is_dt_flag(cell.value) ? [] : cell.value;
        const elements = array?.kind === "array" ? array.elements : [];
        expect(elements.map(element => element.kind === "number" ? element.repr : element.kind)).toEqual(["hex", "dec"]);
        expect(PropertyBuilder.to_string(cell)).toContain("reg = <0x2a 5>;");
    });

    test("tag_number — a hex repr is kept in every row of a matrix", () => {
        const cell = PropertyBuilder.build_cell_array()
            .with_tagged_values([[PropertyBuilder.tag_number(0x10n, "hex")], [PropertyBuilder.tag_number(0x20n, "hex"), PropertyBuilder.tag_number(3)]])
            .with_name("reg")
            .build();
        expect(PropertyBuilder.to_string(cell)).toContain("reg = <0x10>, <0x20 3>;");
    });
}