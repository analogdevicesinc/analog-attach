import { Command } from "commander";
import {
    DeviceTree,
    DeviceTreeOverlay,
    NodeBuilder,
    PropertyBuilder,
    parse_unit_address,
    format_unit_address,
    address_cells_of,
    encode_reg_address,
    next_free_unit_address,
    is_valid_label,
    label_from_compatible,
    unique_label,
    get_full_node_name,
    type DTProperty,
    type DTNode,
} from "attach-lib";

import type { LocalContext } from "../../context";
import { load_config, check_config, check_failure_message } from "../../config";
import { find_binding, load_trees, resolve_path, base_target, write_overlay } from "../../utilities";
import { resolve_config } from "../../resolve-config";
import { respond, respond_fail, input_error, diagnostic } from "../../protocol/output";
import { resolve_node_binding } from "../../binding-resolution";
import type { AddResponse } from "../../protocol/types";
import { create_workfile } from "../../workfile";

export type AddResult =
    | { status: "added"; key: string; path: string[]; label?: string; diagnostics: string[] }
    | { status: "parent-not-found" }
    | { status: "duplicate"; message: string }
    | { status: "label-taken"; message: string }
    | { status: "invalid-label"; message: string }
    | { status: "bad-unit-address"; message: string };

export function build_add_command(context_: LocalContext): Command {
    return new Command("add")
        .description("Add a device node to an overlay (e.g. `add adi,ad7124-8 --parent spi0`). Use `update <path> <child>` for child nodes like channels.")
        .argument("<key>", "Compatible string of the device binding to add")
        .option("--parent <value>", "Parent node: label or path (e.g. spi0, /soc/spi@7e204000)")
        .option("--name <value>", "Node name override (e.g. adc@0); defaults to the compatible string")
        .option("--label <value>", "Label to attach to the new node (e.g. imu1)")
        .action(async (key: string, options) => {
            const pre_config = load_config() ?? {};
            const pre_check = check_config(pre_config, ["linux", "dtSchema", "context"]);
            if (!pre_check.ok) {
                const message = check_failure_message(pre_check);
                if (context_.json) { input_error(message.json); }
                else { console.log(message.human); }
                return;
            }

            let created_message: string | undefined;
            if (pre_config.overlay === undefined) {
                const workfile = create_workfile(pre_config);
                if ("error" in workfile) {
                    if (context_.json) { respond_fail({ ok: false, message: workfile.error, severity: "error" }); }
                    else { console.log(workfile.error); }
                    return;
                }
                created_message = workfile.message;
                if (context_.json) { diagnostic(created_message); }
                else { console.log(created_message); }
            }

            const resolved = resolve_config(context_, ["linux", "dtSchema", "context", "overlay"]);
            if (resolved === undefined) { return; }
            const { linux, dtSchema, context, overlay: input } = resolved.values;

            const { name, label } = options;
            const to: string | undefined = options.parent;

            const trees = load_trees(context_, context, input, resolved.parsed.context);
            if (trees === undefined) { return; }
            const { base_dt: base, overlay } = trees;

            const binding_path = await find_binding(linux, dtSchema, key, context_.json);
            if (binding_path === undefined) {
                if (context_.json) { respond_fail({ ok: false, message: `Failed to find binding for ${key}`, severity: "error" }); }
                else { console.log(`Failed to find binding for ${key}`); }
                return;
            }

            // R3: check if binding defines reg to decide auto-addressing
            let binding_has_reg = false;
            try {
                const stub_node: DTNode = { name: key, unit_addr: undefined, labels: [], children: [], properties: [
                    PropertyBuilder.build_string().with_value(key).with_name("compatible").build(),
                ] };
                const binding = await resolve_node_binding(stub_node, undefined, "", base, linux, dtSchema, context_.json);
                if (!("error" in binding)) {
                    binding_has_reg = binding.properties.some(p => p.key === "reg");
                }
            } catch { /* best-effort */ }

            const node_name = name ?? key;
            const result = add_overlay_node(base, overlay, node_name, to, label, key, binding_has_reg);

            switch (result.status) {
                case "parent-not-found": {
                    if (context_.json) { respond_fail({ ok: false, message: `Parent node ${to} not found`, severity: "error" }); }
                    else { console.log(`Couldn't find parent node ${to} in ${context} or ${input}`); }
                    return;
                }
                case "duplicate": case "label-taken": case "invalid-label": case "bad-unit-address": {
                    if (context_.json) { respond_fail({ ok: false, message: result.message, severity: "error" }); }
                    else { console.log(result.message); }
                    return;
                }
                case "added": {
                    write_overlay(input, overlay, resolved.config);
                    for (const diag of result.diagnostics) {
                        if (context_.json) { diagnostic(diag); }
                        else { console.log(diag); }
                    }
                    const label_suffix = result.label !== undefined ? ` (label: ${result.label})` : "";
                    const added_message = `Added ${result.key}${label_suffix}`;
                    const full_message = created_message !== undefined
                        ? `${created_message}; ${added_message}`
                        : added_message;
                    if (context_.json) {
                        const response: AddResponse = {
                            ok: true,
                            message: full_message,
                            severity: "info",
                            key: result.key,
                            path: result.path,
                        };
                        respond(response);
                    } else {
                        console.log(`${added_message} to ${input}`);
                    }
                    return;
                }
            }
        });
}

export function add_overlay_node(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    node_name: string,
    parent_identifier: string | undefined,
    explicit_label: string | undefined,
    compatible: string | undefined,
    binding_has_reg: boolean,
): AddResult {
    const diagnostics: string[] = [];

    // R8: validate explicit label
    if (explicit_label !== undefined) {
        if (!is_valid_label(explicit_label)) {
            return { status: "invalid-label", message: `Invalid label: ${explicit_label} (must match [A-Za-z_][A-Za-z0-9_]*)` };
        }
        const all_labels = overlay.all_labels();
        if (all_labels.has(explicit_label)) {
            const owner = all_labels.get(explicit_label)!;
            return { status: "label-taken", message: `Label ${explicit_label} is already used by ${owner}` };
        }
    }

    // Parse node name for unit address
    const at = node_name.indexOf('@');
    const base_name = at === -1 ? node_name : node_name.slice(0, at);
    const explicit_unit = at === -1 ? undefined : node_name.slice(at + 1);

    if (explicit_unit === "") {
        return { status: "bad-unit-address", message: "Empty unit address (name@ is invalid)" };
    }

    // Resolve parent path for effective_children and addressing
    let parent_path: string;
    let parent_overlay_node: DTNode | undefined;
    if (parent_identifier === undefined) {
        parent_path = "/";
    } else {
        const resolved = resolve_path(parent_identifier, overlay, base);
        if (resolved.in_overlay !== undefined) {
            parent_path = resolved.in_overlay.node_path;
            parent_overlay_node = resolved.in_overlay.node;
        } else if (resolved.in_base !== undefined) {
            parent_path = resolved.in_base.full_path.path;
        } else {
            return { status: "parent-not-found" };
        }
    }

    const effective = overlay.effective_children(parent_path);

    // Determine unit address
    let unit: string | undefined = explicit_unit;
    let reg_property: DTProperty | undefined;

    if (explicit_unit !== undefined) {
        // R7: explicit unit always creates reg
        const parsed = parse_unit_address(explicit_unit);
        if (parsed !== undefined) {
            const cells = address_cells_of(overlay, parent_path);
            reg_property = encode_reg_address(parsed, cells.address, cells.size);
            if (cells.size > 0) {
                diagnostics.push("reg size set to 0; update reg with the real size");
            }
        } else {
            diagnostics.push(`Non-hex unit address "${explicit_unit}"; no reg created`);
        }
    } else if (binding_has_reg) {
        // R3/R6: auto-pick unit address
        const cells = address_cells_of(overlay, parent_path);
        const { address, occupants } = next_free_unit_address(effective, cells.address);
        unit = format_unit_address(address);
        reg_property = encode_reg_address(address, cells.address, cells.size);
        if (cells.size > 0) {
            diagnostics.push("reg size set to 0; update reg with the real size");
        }
        if (address > 0n) {
            const listing = occupants.map(o => `${o.address} ${o.name}`).join(", ");
            diagnostics.push(`picked @${unit}: ${listing}`);
        }
    }

    const node_key = unit === undefined ? base_name : `${base_name}@${unit}`;

    // R2: duplicate check
    if (effective.has(node_key)) {
        return { status: "duplicate", message: `${parent_path === "/" ? "/" : parent_path} already has a child named ${node_key}` };
    }

    // R8: default label
    let label = explicit_label;
    if (label === undefined && compatible !== undefined) {
        const all_labels = overlay.all_labels();
        const default_label = label_from_compatible(compatible);
        label = unique_label(default_label, all_labels);
    }

    // Build the node
    const compatible_property: DTProperty | undefined = compatible !== undefined
        ? PropertyBuilder.build_string().with_value(compatible).with_name("compatible").build()
        : undefined;

    const properties: DTProperty[] = [];
    if (compatible_property !== undefined) { properties.push(compatible_property); }
    if (reg_property !== undefined) { properties.push(reg_property); }

    const new_node = NodeBuilder.new()
        .with_name(base_name)
        .with_unit_address(unit)
        .with_label(label !== undefined ? [label] : [])
        .with_properties(properties.length > 0 ? properties : undefined);

    // C3: write #address-cells/#size-cells on overlay-added parent if missing
    if (unit !== undefined && parent_overlay_node !== undefined) {
        const has_addr_cells = parent_overlay_node.properties.some(p => p.name === "#address-cells");
        if (!has_addr_cells) {
            const base_dt = overlay.get_base_dts();
            let base_has_cells = false;
            if (base_dt !== undefined) {
                const base_ref = base_dt.get_node_by_path({ kind: "path", labels: [], path: parent_path });
                if (base_ref !== undefined) {
                    const base_node = base_dt.deref_node(base_ref);
                    if (base_node !== undefined) {
                        base_has_cells = base_node.properties.some(p => p.name === "#address-cells");
                    }
                }
            }
            if (!base_has_cells) {
                parent_overlay_node.properties.push(
                    PropertyBuilder.build_cell_array().with_tagged_values(PropertyBuilder.tag_number(1n)).with_name("#address-cells").build(),
                    PropertyBuilder.build_cell_array().with_tagged_values(PropertyBuilder.tag_number(0n)).with_name("#size-cells").build(),
                );
            }
        }
    }

    // Insert the node
    if (parent_identifier === undefined) {
        // eslint-disable-next-line unicorn/no-useless-undefined
        overlay.add_fragment({ kind: "path", labels: [], path: "/" }, new_node, undefined);
    } else if (parent_overlay_node !== undefined) {
        parent_overlay_node.children.push(new_node.build());
    } else {
        const base_reference = base_target(resolve_path(parent_identifier, overlay, base));
        if (base_reference === undefined) { return { status: "parent-not-found" }; }
        // eslint-disable-next-line unicorn/no-useless-undefined
        overlay.add_fragment(base_reference, new_node, undefined);
    }

    // Resolve the final path
    const search_ref = label !== undefined
        ? { kind: "label" as const, labels: [] as string[], name: label }
        : { kind: "path" as const, labels: [] as string[], path: `${parent_path === "/" ? "" : parent_path}/${node_key}` };
    const found = overlay.find_node(search_ref);
    const path_segments = found === undefined ? [node_key] : found.node_path.split("/").filter(Boolean);

    return { status: "added", key: node_key, path: path_segments, label, diagnostics };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO_cls } = await import('attach-lib');

    const base_dts = `/dts-v1/;
/ {
    #address-cells = <2>;
    soc {
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
            spidev@0 {
                reg = <0>;
                compatible = "spidev";
            };
            spidev@1 {
                reg = <1>;
                compatible = "spidev";
            };
        };
        spi1: spi@7e205000 {
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`;

    const empty_overlay = `/dts-v1/;
/plugin/;

&spi0 {
};`;

    test("add_overlay_node — adds node with auto unit address and reg", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // eslint-disable-next-line unicorn/no-useless-undefined
        const result = add_overlay_node(base, overlay, "adi,ad7124-8", "spi0", undefined, "adi,ad7124-8", true);

        expect(result.status).toBe("added");
        if (result.status !== "added") { return; }
        expect(result.key).toBe("adi,ad7124-8@2");
        expect(result.label).toBe("ad7124_8");
        const output = overlay.print();
        expect(output).toContain("adi,ad7124-8@2");
        expect(output).toContain("reg = <2>");
        expect(output).toContain("ad7124_8:");
    });

    test("add_overlay_node — second add gets @3 and indexed label", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // eslint-disable-next-line unicorn/no-useless-undefined
        add_overlay_node(base, overlay, "adi,ad7124-8", "spi0", undefined, "adi,ad7124-8", true);
        // eslint-disable-next-line unicorn/no-useless-undefined
        const result = add_overlay_node(base, overlay, "adi,ad7124-8", "spi0", undefined, "adi,ad7124-8", true);

        expect(result.status).toBe("added");
        if (result.status !== "added") { return; }
        expect(result.key).toBe("adi,ad7124-8@3");
        expect(result.label).toBe("ad7124_8_1");
    });

    test("add_overlay_node — explicit name@a creates reg <0xa>", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // eslint-disable-next-line unicorn/no-useless-undefined
        const result = add_overlay_node(base, overlay, "adc@a", "spi0", undefined, "adi,ad7124-8", false);

        expect(result.status).toBe("added");
        if (result.status !== "added") { return; }
        expect(result.key).toBe("adc@a");
        const output = overlay.print();
        expect(output).toContain("adc@a");
    });

    test("add_overlay_node — duplicate refused", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "spidev@0", "spi0", "x", "spidev", false);
        expect(result.status).toBe("duplicate");
    });

    test("add_overlay_node — label-taken refused", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "x", "spi0", "spi0", "x", false);
        expect(result.status).toBe("label-taken");
    });

    test("add_overlay_node — invalid label refused", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "x", "spi0", "1bad", "x", false);
        expect(result.status).toBe("invalid-label");
    });

    test("add_overlay_node — no unit address when binding has no reg", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // eslint-disable-next-line unicorn/no-useless-undefined
        const result = add_overlay_node(base, overlay, "regulator-fixed", undefined, undefined, "regulator-fixed", false);
        expect(result.status).toBe("added");
        if (result.status !== "added") { return; }
        expect(result.key).toBe("regulator-fixed");
        expect(overlay.print()).toContain("regulator-fixed {");
        expect(overlay.print()).not.toContain("regulator-fixed@");
    });

    test("add_overlay_node — parent-not-found", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "x", "i2c0", "x", "x", false);
        expect(result.status).toBe("parent-not-found");
    });
}
