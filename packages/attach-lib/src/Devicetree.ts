import { INodeBuilderBase, NodeBuilder, PropertyBuilder } from "./DTBuilder/DTBuilder";
import { DtsDocument, DtsNode, parse_dts } from "./dts";
import { find_node_by_path } from "./dts/merge";
import { print_dts } from "./dts/printer";
import { isDtsoOverlay, printDtso } from "./dtso";

export class DeviceTree {

    private devicetree: { value: DtsDocument, is_overlay: boolean };

    private constructor(devicetree: DtsDocument, is_overlay: boolean) {
        this.devicetree = {
            value: devicetree,
            is_overlay: is_overlay
        };
    }

    static new_from_string(devicetree_content: string): DeviceTree | string {
        try {
            return new DeviceTree(parse_dts(devicetree_content), isDtsoOverlay(devicetree_content));
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
                    _uuid: crypto.randomUUID(),
                    children: [],
                    properties: [],
                    deleted: false,
                },
                unresolved_overlays: [],
                metadata: undefined
            },
            false
        );
    }

    static new_empty_overlay(): DeviceTree {
        return new DeviceTree(
            {
                memreserves: [],
                root: {
                    name: "/",
                    unit_addr: undefined,
                    labels: [],
                    _uuid: crypto.randomUUID(),
                    children: [],
                    properties: [],
                    deleted: false,
                },
                unresolved_overlays: [],
                metadata: undefined
            },
            true
        );
    }

    public add_node(node: INodeBuilderBase, path: string): undefined | DtsNode {

        if (this.devicetree.is_overlay) {

            const target_overlay = this.devicetree.value.unresolved_overlays.find((entry) => {
                switch (entry.overlay_target_ref.ref.kind) {
                    case "label": {
                        return entry.overlay_target_ref.ref.name === path;
                    }
                    case "path": {
                        return entry.overlay_target_ref.ref.path === path;
                    }
                }
            });

            if (target_overlay === undefined) {
                this.devicetree.value.unresolved_overlays.push({
                    overlay_target_ref: {
                        kind: 'ref',
                        labels: [],
                        ref: {
                            kind: "path",
                            path: path
                        }
                    },
                    overlay_node: {
                        labels: [],
                        name: "",
                        _uuid: crypto.randomUUID(),
                        unit_addr: undefined,
                        properties: [],
                        children: [node.build()],
                        deleted: false
                    }
                });

                return undefined;
            }

            const actual_node = node.build();

            const target_node = target_overlay.overlay_node.children.find((entry) => entry.name === actual_node.name);

            if (target_node === undefined) {
                target_overlay.overlay_node.children.push(actual_node);
                return undefined;
            }

            let node_being_overwritten = target_node.children.find((entry) => entry.name === actual_node.name);

            if (node_being_overwritten === undefined) {
                target_node.children.push(actual_node);
                return undefined;
            }

            const old_value = structuredClone(node_being_overwritten);
            node_being_overwritten = actual_node;
            return old_value;
        } else {
            const target_node = find_node_by_path(this.devicetree.value.root, path);

            if (target_node === undefined) {
                return undefined;
            }

            const actual_node = node.build();

            let node_being_overwritten = target_node.children.find((entry) => entry.name === actual_node.name);

            if (node_being_overwritten === undefined) {
                target_node.children.push(actual_node);
                return undefined;
            }

            const old_value = structuredClone(node_being_overwritten);
            node_being_overwritten = actual_node;
            return old_value;
        }
    }


    public print(): string {
        if (this.devicetree.is_overlay) {
            return printDtso(this.devicetree.value);
        }

        return print_dts(this.devicetree.value);
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
                    .with_user_modifications(true)
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
                    .with_user_modifications(true)
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