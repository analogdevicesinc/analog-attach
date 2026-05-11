import { INodeBuilderBase, NodeBuilder, PropertyBuilder } from "./DTBuilder/DTBuilder";
import { DTS, DTO, DTNode, parse_dts, parse_dto } from "./dts";
import { print_dts, print_dto } from "./dts/printer";

export class DeviceTree {

    private devicetree: DTS;
    private overlay: DTO | undefined;

    private constructor(devicetree: DTS, overlay?: DTO) {
        this.devicetree = devicetree;
        this.overlay = overlay;
    }

    static new_from_string(devicetree_content: string): DeviceTree | string {
        try {
            const dts = parse_dts(devicetree_content);

            if (typeof dts === 'string') {
                const dto = parse_dto(devicetree_content);

                if (typeof dto === 'string') {
                    return "Failed to parse!";
                }

                return new DeviceTree(this.new_empty().devicetree, dto);
            }

            return new DeviceTree(dts, undefined);
        } catch (error) {
            return error instanceof Error ? error.message : "Failed to parse!";
        }
    }

    static new_empty(): DeviceTree {
        return new DeviceTree(
            {
                memreserves: [],
                root: {
                    name: "/",
                    unit_addr: undefined,
                    labels: [],
                    children: [],
                    properties: [],
                },
            },
        );
    }

    static new_empty_overlay(): DeviceTree {
        return new DeviceTree(
            this.new_empty().devicetree,
            {
                root: {
                    name: "/",
                    unit_addr: undefined,
                    labels: [],
                    children: [],
                    properties: [],
                },
            },
        );
    }

    public add_node(node: INodeBuilderBase, path: string): undefined | DTNode {
        return;
    }

    public print(): string {
        if (this.overlay !== undefined) {
            return print_dto(this.overlay);
        }

        return print_dts(this.devicetree);
    }
}


if (import.meta.vitest !== undefined) {

    const { test, expect } = import.meta.vitest;

    test("Print empty DTS", () => {
        const dt = DeviceTree.new_empty();
        const dts = dt.print();

        expect(dts).toStrictEqual(`/dts-v1/;
/ {
};
`);
    });

    test("Print empty DTO", () => {
        const dt = DeviceTree.new_empty_overlay();
        const dts = dt.print();

        expect(dts).toStrictEqual(`/dts-v1/;
/plugin/;

`);
    });

    test("Add node and print DTS", () => {
        const dt = DeviceTree.new_empty();

        const new_node = NodeBuilder.new()
            .with_name("adc")
            .with_label("ad7124")
            .with_unit_address("0")
            .with_properties(PropertyBuilder.build_string().with_value("adi,ad7124-8").with_name("compatible").build());

        dt.add_node(new_node, "/");

        const dts = dt.print();

        expect(dts).toStrictEqual(`/dts-v1/;
/ {
\tad7124: adc@0 {
\t\tcompatible = "adi,ad7124-8";
\t};
};
`);
    });

    test("Overwrite node and print DTS", () => {
        const dt = DeviceTree.new_from_string(`/dts-v1/;
/ {
\tad7124: adc@0 {
\t\tcompatible = "adi,ad7124-8";
\t\treg= <0>
\t};
};
`);

        if (typeof dt === 'string') {
            expect(false);
            return;
        }

        const new_node = NodeBuilder.new()
            .with_name("adc")
            .with_label("ad7124")
            .with_unit_address("0")
            .with_properties(PropertyBuilder.build_string().with_value("adi,ad7124-4").with_name("compatible").build());

        const success = dt.add_node(new_node, "/");

        expect(success).toBeUndefined();

        const dts = dt.print();

        expect(dts).toStrictEqual(`/dts-v1/;
/ {
\tad7124: adc@0 {
\t\tcompatible = "adi,ad7124-4";
\t};
};
`);
    });

    test("Add node and print DTO", () => {
        const dt = DeviceTree.new_empty_overlay();

        const new_node = NodeBuilder.new()
            .with_name("adc")
            .with_label("ad7124")
            .with_unit_address("0")
            .with_properties(
                PropertyBuilder.build_string()
                    .with_value("adi,ad7124-8")
                    .with_name("compatible")
                    .build()
            );

        const success = dt.add_node(new_node, "/");

        expect(success).toBeUndefined();

        const dts = dt.print();

        expect(dts).toStrictEqual(`/dts-v1/;
/plugin/;

&{/} {
\tad7124: adc@0 {
\t\tcompatible = "adi,ad7124-8";
\t};
};
`);
    });

    test("Overwrite node and print DTO", () => {
        const dt = DeviceTree.new_from_string(`/dts-v1/;
/plugin/;

&{/} {
\tad7124: adc@0 {
\t\tcompatible = "adi,ad7124-8";
\t};
};
`);

        if (typeof dt === 'string') {
            expect(false);
            return;
        }

        const new_node = NodeBuilder.new()
            .with_name("adc")
            .with_label("ad7124")
            .with_unit_address("0")
            .with_properties(
                PropertyBuilder.build_string()
                    .with_value("adi,ad7124-4")
                    .with_name("compatible")
                    .build()
            );

        const success = dt.add_node(new_node, "/");

        expect(success).not.toBeUndefined();

        const dts = dt.print();

        expect(dts).toStrictEqual(`/dts-v1/;
/plugin/;

&{/} {
\tad7124: adc@0 {
\t\tcompatible = "adi,ad7124-4";
\t};
};
`);
    });
}