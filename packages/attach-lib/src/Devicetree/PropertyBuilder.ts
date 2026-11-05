import { Bits, DTProperty, is_dt_flag, print_property } from "./Parser/index.js";
import { CellInput, CellValue, make_cell_array, NumberRepr } from "./Types.js";
import { AddCallOnce } from "./TypeUtilities.js";

interface IFlagPropertyBuilder {
    set_flag(): IPropertyNameBuilder;
}

interface IStringPropertyBuilder {
    /** The strings in order, a list given as one argument or several: `"a", "b", "c"`. */
    with_value(...values: (string | string[])[]): IPropertyNameBuilder;
}

interface ICellArrayPropertyBuilder {
    /** One `<…>` of `cells`: numbers, or the cells `PropertyBuilder.number` / `label` / `path` / `expression` make. */
    with_cells(...cells: CellInput[]): IPropertyNameBuilder;
    /** One `<…>` per row: `<0 1>, <2 3>`. */
    with_rows(...rows: CellInput[][]): IPropertyNameBuilder;
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
    ICellArrayPropertyBuilder,
    IPropertyNameBuilder,
    IPropertyBuild {

    private property: DTProperty = {
        labels: [],
        name: "",
        value: [],
    };

    private constructor(private readonly bit_width: Bits = Bits.b32) {
    }

    static build_flag(): IFlagPropertyBuilder {
        return new PropertyBuilder();
    }

    static build_string(): IStringPropertyBuilder {
        return new PropertyBuilder;
    }

    /** Cells of `bits` bits: a binding's `typeSize` (`uint64` is `/bits/ 64 <…>`), 32 by default. */
    static build_cell_array(bits: 8 | 16 | 32 | 64 = 32): ICellArrayPropertyBuilder {
        return new PropertyBuilder(bits as Bits);
    }

    set_flag(): IPropertyNameBuilder {
        this.property.value = { kind: "flag" };
        return this;
    }

    with_value(...values: (string | string[])[]): IPropertyNameBuilder {
        this.property.value = values.flat().map((value) => ({ kind: "string", value, labels: [] }));
        return this;
    }

    with_cells(...cells: CellInput[]): IPropertyNameBuilder {
        this.property.value = [make_cell_array(cells, this.bit_width)];
        return this;
    }

    with_rows(...rows: CellInput[][]): IPropertyNameBuilder {
        this.property.value = rows.map((row) => make_cell_array(row, this.bit_width));
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

    /** A number cell, printed in decimal unless `repr` says hex (as the parser keeps a `0x…` literal); a bare number is a decimal one. */
    static number(value: number | bigint, repr?: NumberRepr): CellValue {
        return { _tag: "number", value: BigInt(value), ...(repr === undefined ? {} : { repr }) };
    }

    /** A reference to the node with `name` as label: `&name`. */
    static label(name: string): CellValue {
        return { _tag: "label", value: name };
    }

    /** A reference to the node at `path`: `&{/path}`. */
    static path(path: string): CellValue {
        return { _tag: "path", value: path };
    }

    /** A C expression, written as given: `(1 + 1)`. */
    static expression(expression: string): CellValue {
        return { _tag: "expression", value: expression };
    }
}

if (import.meta.vitest !== undefined) {

    const { test, expect } = import.meta.vitest;

    const { label, path, expression } = PropertyBuilder;

    const row: CellInput[] = [0, label("gpio0"), path("/soc/gpio0"), expression("(1+1)")];

    // What each way of giving a builder its values prints: a property is written as the overlay will hold it
    test.each<[string, () => DTProperty, string]>([
        ["flag", () => PropertyBuilder.build_flag().set_flag().with_name("spi-controller").build(), "spi-controller;"],
        ["string", () => PropertyBuilder.build_string().with_value("adi,ad7124").with_name("compatible").build(), `compatible = "adi,ad7124";`],
        ["string array", () => PropertyBuilder.build_string().with_value(["adi,ad7124", "adi,adxl355"]).with_name("compatible").build(), `compatible = "adi,ad7124", "adi,adxl355";`],
        ["strings", () => PropertyBuilder.build_string().with_value("adi,ad7124", "adi,adxl355").with_name("compatible").build(), `compatible = "adi,ad7124", "adi,adxl355";`],
        [
            "a string between string arrays",
            () => PropertyBuilder.build_string().with_value(["adi,ad7124-4"], "adi,ad7124-8", ["adi,adxl355"]).with_name("compatible").build(),
            `compatible = "adi,ad7124-4", "adi,ad7124-8", "adi,adxl355";`,
        ],
        ["cells", () => PropertyBuilder.build_cell_array().with_cells(...row).with_name("cells").build(), "cells = <0 &gpio0 &{/soc/gpio0} (1+1)>;"],
        ["rows", () => PropertyBuilder.build_cell_array().with_rows(row.slice(1, 3), [row[0]!, row[3]!]).with_name("cells").build(), "cells = <&gpio0 &{/soc/gpio0}>, <0 (1+1)>;"],
        ["64-bit cells", () => PropertyBuilder.build_cell_array(64).with_cells(0x1_00_00_00_00, 1n).with_name("cells").build(), "cells = /bits/ 64 <4294967296 1>;"],
        [
            "64-bit rows, each its own /bits/",
            () => PropertyBuilder.build_cell_array(64).with_rows([1, 2], [3n, 4n]).with_name("cells").build(),
            "cells = /bits/ 64 <1 2>, /bits/ 64 <3 4>;",
        ],
        ["8-bit cells", () => PropertyBuilder.build_cell_array(8).with_cells(255).with_name("cells").build(), "cells = /bits/ 8 <255>;"],
    ])("%s", (_name, build, printed) => {
        expect(PropertyBuilder.to_string(build())).toBe(`${printed}\n`);
    });

    test("number — a hex repr is kept and printed, decimal is the default", () => {
        expect(PropertyBuilder.number(5)).toStrictEqual({ _tag: "number", value: 5n });
        const cell = PropertyBuilder.build_cell_array()
            .with_cells(PropertyBuilder.number(0x2An, "hex"), PropertyBuilder.number(5), 6)
            .with_name("reg")
            .build();
        const [array] = is_dt_flag(cell.value) ? [] : cell.value;
        const elements = array?.kind === "array" ? array.elements : [];
        expect(elements.map(element => element.kind === "number" ? element.repr : element.kind)).toEqual(["hex", "dec", "dec"]);
        expect(PropertyBuilder.to_string(cell)).toContain("reg = <0x2a 5 6>;");
    });

    test("number — a hex repr is kept in every row", () => {
        const cell = PropertyBuilder.build_cell_array()
            .with_rows([PropertyBuilder.number(0x10n, "hex")], [PropertyBuilder.number(0x20n, "hex"), 3])
            .with_name("reg")
            .build();
        expect(PropertyBuilder.to_string(cell)).toContain("reg = <0x10>, <0x20 3>;");
    });
}
