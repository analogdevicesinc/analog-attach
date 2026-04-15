/* eslint-disable unicorn/consistent-function-scoping */
import { CellArrayElement, DtsCellArray, DtsProperty } from "./dts";
import { print_property } from "./dts/printer";

interface IFlagPropertyBuilder {
    set_flag: () => INameBuilder;
}

interface IStringPropertyBuilder {
    with_value: (first: string | string[], ...rest: string[]) => INameBuilder;
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
    with_name: (name: string) => ILabelsBuilder;
}

interface ILabelsBuilder {
    with_labels: (labels: string[]) => IModifiedBuilder;
}

interface IModifiedBuilder {
    with_user_modifications: (modified_by_user: boolean) => IBuild;
}

interface IBuild {
    build: () => DtsProperty;
}

class PropertyBuilder implements
    IFlagPropertyBuilder,
    IStringPropertyBuilder,
    IReferencePropertyBuilder,
    ICellArrayPropertyBuilder,
    INameBuilder,
    ILabelsBuilder,
    IModifiedBuilder,
    IBuild {

    private property: DtsProperty = {
        labels: [],
        name: "",
        deleted: false,
        modified_by_user: false
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

    with_value(first: string | string[], ...rest: string[]): INameBuilder {

        const normalized_value = first === undefined ? [] : (Array.isArray(first) ? [...first, ...rest] : [first, ...rest]);

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

        if (is_not_2d(rest)) {
            // Single component mode: flatten first + rest into one component
            const normalized_values = first === undefined ? [] : (Array.isArray(first) ? [...first, ...rest] : [first, ...rest]);
            this.property.value = {
                components: [make_cell_array(normalized_values)]
            };
        } else {
            // Multiple components mode: each array becomes a component, each single value becomes a single-element component
            const all_arguments: (TaggedCellValue | TaggedCellValue[])[] = [first, ...rest];
            this.property.value = {
                components: all_arguments.map((argument) => make_cell_array(Array.isArray(argument) ? argument : [argument]))
            };
        }

        return this;
    }

    with_name(name: string): ILabelsBuilder {
        this.property.name = name;
        return this;
    }

    with_labels(labels: string[]): IModifiedBuilder {
        this.property.labels = labels;
        return this;
    }

    with_user_modifications(modified_by_user: boolean): IBuild {
        this.property.modified_by_user = modified_by_user;
        return this;
    }

    static to_string(property: DtsProperty): string {
        return print_property(property, "", 0);
    }

    build(): DtsProperty {
        return this.property;
    }
}

if (import.meta.vitest !== undefined) {

    const { test } = import.meta.vitest;

    test("property builder", () => {

        const flag: DtsProperty = PropertyBuilder.build_flag()
            .set_flag()
            .with_name("spi-controller")
            .with_labels([])
            .with_user_modifications(true)
            .build();

        console.log(`${PropertyBuilder.to_string(flag)}`);

        const compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value("adi,ad7124")
            .with_name("compatible")
            .with_labels([])
            .with_user_modifications(true)
            .build();

        console.log(`${PropertyBuilder.to_string(compatible)}`);

        const long_compatible: DtsProperty = PropertyBuilder.build_string()
            .with_value(["adi,ad7124", "adi,adxl355"])
            .with_name("compatible")
            .with_labels([])
            .with_user_modifications(true)
            .build();

        console.log(`${PropertyBuilder.to_string(long_compatible)}`);

        const long_compatible_2: DtsProperty = PropertyBuilder.build_string()
            .with_value("adi,ad7124", "adi,adxl355")
            .with_name("compatible")
            .with_labels([])
            .with_user_modifications(true)
            .build();

        console.log(`${PropertyBuilder.to_string(long_compatible_2)}`);

        const long_compatible_3: DtsProperty = PropertyBuilder.build_string()
            .with_value(["adi,ad7124", "adi,adxl355"], "my_generic")
            .with_name("compatible")
            .with_labels([])
            .with_user_modifications(true)
            .build();

        console.log(`${PropertyBuilder.to_string(long_compatible_3)}`);

        const label_reference: DtsProperty = PropertyBuilder.build_reference()
            .with_label("gpio0")
            .with_name("gpio")
            .with_labels([])
            .with_user_modifications(false)
            .build();

        console.log(`${PropertyBuilder.to_string(label_reference)}`);

        const path_reference: DtsProperty = PropertyBuilder.build_reference()
            .with_path("/soc/gpio0")
            .with_name("gpio2")
            .with_labels([])
            .with_user_modifications(false)
            .build();

        console.log(`${PropertyBuilder.to_string(path_reference)}`);

        const tag_number = (value: number | bigint) => { return { _tag: "number" as const, value: BigInt(value) }; };
        const tag_u64 = (value: number | bigint) => { return { _tag: "u64" as const, value: BigInt(value) }; };
        const tag_label = (value: string) => { return { _tag: "label" as const, value: value }; };
        const tag_path = (value: string) => { return { _tag: "path" as const, value: value }; };
        const tag_expression = (value: string) => { return { _tag: "expression" as const, value: value }; };

        const potential_input = ["gpio", 25, 2];
        const tagged_input = potential_input.map((entry) => {
            if (typeof entry === 'string') {
                return tag_label(entry);
            } else if (typeof entry === 'number' || typeof entry === 'bigint') {
                return tag_number(entry);
            }
            return tag_expression(entry);
        });

        const simple_cell = PropertyBuilder.build_cell_array()
            .with_tagged_values([tag_expression("0")], [tag_number(0), tag_expression("0"), tag_number(0)])
            .with_name("interrupts")
            .with_labels([])
            .with_user_modifications(false)
            .build();

        console.log(`${PropertyBuilder.to_string(simple_cell)}`);

        const simple_cell_0 = PropertyBuilder.build_cell_array()
            .with_tagged_values([tag_u64(0x11_22_33_44_55_66_77_88n)])
            .with_name("#address-cells")
            .with_labels([])
            .with_user_modifications(false)
            .build();

        console.log(`${PropertyBuilder.to_string(simple_cell_0)}`);

        const simple_cell_1 = PropertyBuilder.build_cell_array()
            .with_tagged_values([tag_number(0)])
            .with_name("#address-cells")
            .with_labels([])
            .with_user_modifications(false)
            .build();

        console.log(`${PropertyBuilder.to_string(simple_cell_1)}`);

        const simple_cell_2 = PropertyBuilder.build_cell_array()
            .with_tagged_values([tag_label("gpio"), tag_number(25), tag_number(2)])
            .with_name("#address-cells")
            .with_labels([])
            .with_user_modifications(false)
            .build();

        console.log(`${PropertyBuilder.to_string(simple_cell_2)}`);

        const simple_cell_3 = PropertyBuilder.build_cell_array()
            .with_tagged_values([tag_path("/soc/gpio"), tag_number(25), tag_number(2)])
            .with_name("#address-cells")
            .with_labels([])
            .with_user_modifications(false)
            .build();

        console.log(`${PropertyBuilder.to_string(simple_cell_3)}`);

        const simple_cell_4 = PropertyBuilder.build_cell_array()
            .with_tagged_values([tag_path("/soc/gpio"), tag_number(25), tag_expression("(1 + 1)")])
            .with_name("#address-cells")
            .with_labels([])
            .with_user_modifications(false)
            .build();

        console.log(`${PropertyBuilder.to_string(simple_cell_4)}`);
    });

}