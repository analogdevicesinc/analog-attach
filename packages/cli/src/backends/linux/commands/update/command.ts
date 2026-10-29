import {
    DeviceTree,
    DeviceTreeOverlay,
    NodeBuilder,
    PropertyBuilder,
    is_dt_flag,
    get_full_node_name,
    address_cells_of,
    encode_reg_address,
    ensure_address_cells,
    parse_unit_address,
    sync_unit_address_from_reg,
    unit_radix,
    type DTNode,
    type DTProperty,
    type DTLabel,
    type DTPath,
    type FoundNodeResult,
    type NodeTarget,
    type ResolvedProperty,
    effective_interrupt_parent,
    base_lookup,
} from "attach-lib";
import * as fs from "node:fs";

import { answer, command, input_error, PromptCancelled, refuse, type InteractiveSession, type UpdateArguments } from "../../../../interface/backend-interface";
import { load_workspace, type Bindings, type Workfile } from "../../config/workspace";
import { resolve_write_target, parse_node_path, not_found_message } from "../../utilities";
import { child_unit_radix, find_property_definition, resolve_node_binding } from "../../binding-resolution";
import { read_target } from "../read/command";
import { node_reg_warnings, reg_warning_lines } from "../../reg-conflicts";
import { describe_missing, missing_lines, missing_required_of, type NewNode } from "../../missing-required";
import { ask_for_missing } from "../../missing-interview";
import type { UpdateChildResponse, UpdateResponse } from "../../protocol/types";
import { count_warning, value_count } from "../../item-count";
import { build_raw_property, shape_hint, type ShapeHint } from "../../property-value";

/** Where a warning goes: `session.warn`, stderr in every mode. */
export type Warn = (message: string) => void;

/**
 * The binding's definition of a property of the target node, by name or by a
 * property pattern. Without one the value is written unchecked, which `warn`
 * says (`update` passes a no-op when it only reads or sets a flag).
 */
export async function resolve_property_definition(
    binding_node: DTNode | undefined,
    binding_parent: DTNode | undefined,
    parent_name: string,
    base_dt: DeviceTree,
    bindings: Bindings,
    property_name: string,
    warn: Warn,
): Promise<{ definition: ResolvedProperty | undefined }> {
    if (binding_node === undefined) { return { definition: undefined }; }
    const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, bindings);
    if ("error" in binding) {
        warn(`Property ${property_name} written without schema validation: ${binding.error}`);
        return { definition: undefined };
    }
    const result = binding.narrow_and_populate(binding_node);
    if (result === undefined) {
        warn(`Property ${property_name} written without schema validation: failed to narrow binding`);
        return { definition: undefined };
    }
    const definition = find_property_definition(binding, result.properties, property_name);
    if (definition === undefined) {
        const origin_desc = binding.origin.kind === "compatible"
            ? `${binding.origin.compatible} binding`
            : `pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;
        warn(`Property ${property_name} not defined by ${origin_desc}; written without schema validation`);
    }
    return { definition };
}

export type UpdateDecision = "set-flag" | "read" | "value" | { error: string };

export function decide_update(hint: ShapeHint, value_tokens: readonly string[], existing_has_value: boolean): UpdateDecision {
    if (value_tokens.length === 0) {
        if (hint === "flag") { return "set-flag"; }
        if (hint === undefined) {
            return existing_has_value ? "read" : "set-flag";
        }
        return "read";
    }
    if (hint === "flag") {
        return { error: `is a flag: \`update <path> ${""}\` sets it, \`delete <path> ${""}\` clears it` };
    }
    return "value";
}

const child_node_message = (identifier: string, name: string): string =>
    `${name} is a child node; set its properties with \`update ${identifier}/${name} <prop> <value>\``;

export const update = command<UpdateArguments, UpdateResponse>({
    docs: {
        brief: "Update/insert a property",
        full: `Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

Value syntax:
  Numbers:     0, 1, 0x1F                  Cell values
  Macros:      GPIO_ACTIVE_LOW, IRQ_TYPE_EDGE_FALLING, ...
  Labels:      &spi0, spi0                 Phandle references
  Strings:     words without & are strings when the binding expects them
  Arrays:      multiple tokens in one call
  Matrices:    rows separated by ","

Special cases:
  No value     Sets a flag property, or reads the current value (as 'read' does)
  Child name   'update <path> <child-name>' creates a child node and lists
               its missing required properties; an existing child is read
               (as 'read <path>/<child-name>' does)
  reg          'update <path> reg <n>' also renames the node's unit address`,
        examples: [
            "update spi0/adi,ad7124-8@0 spi-max-frequency 1000000",
            "update spi0/adi,ad7124-8@0 reg 1",
            "update spi0/adi,ad7124-8@0 interrupts 25 IRQ_TYPE_EDGE_FALLING",
            "update spi0/adi,ad7124-8@0 io-channels 0 1 , 2 3",
            "update spi0/adi,ad7124-8@0 channel@0",
        ],
    },
    async run({ path: path_argument, property: property_argument, values, quiet }, _flags, session) {
        if (path_argument === undefined) { return input_error("Missing: path"); }
        if (property_argument === undefined) { return input_error("Missing: property name"); }
        const parsed_path = parse_node_path(path_argument);
        if (!parsed_path.ok) { return input_error(parsed_path.error); }
        const node_identifier = parsed_path.value;

        const loaded = load_workspace(session, ["bindings", "base", "overlay"]);
        if (!loaded.ok) { return loaded.outcome; }
        const { workspace } = loaded;
        const base_dt = workspace.base.tree;
        const { tree: overlay } = workspace.overlay;
        const bindings = workspace.bindings;

        const { target_reference, found, is_base_target, binding_node, binding_parent, parent_name } =
            resolve_write_target(node_identifier, overlay, base_dt);
        if (found === undefined && !is_base_target) {
            return refuse(not_found_message(node_identifier, overlay, base_dt));
        }

        const property_name = property_argument;

        // R12: child nodes via update. A name with @ is a child node when the node has it or its binding's patterns allow it.
        if (property_name.includes("@")) {
            const node_path = found?.node_path ?? base_dt.locate(target_reference)?.path ?? node_identifier;
            if (overlay.effective_children(node_path).has(property_name)) {
                if (values.length > 0) { return refuse(child_node_message(node_identifier, property_name)); }
                const child_identifier = node_identifier === "/" ? `/${property_name}` : `${node_identifier}/${property_name}`;
                return read_target(session, overlay, { ok: true, value: bindings }, child_identifier, undefined, { quiet });
            }

            let child_patterns: string[] = [];
            if (binding_node !== undefined) {
                const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, bindings);
                if (!("error" in binding)) { child_patterns = binding.child_nodes.map(c => c.pattern); }
            }
            if (child_patterns.some(pattern => new RegExp(pattern).test(property_name))) {
                if (values.length > 0) { return refuse(child_node_message(node_identifier, property_name)); }

                const child_path = create_child_node(overlay, node_path, property_name, child_patterns);
                workspace.overlay.save();
                const message = `Added ${property_name} to ${node_identifier}`;
                const child: NewNode = {
                    workfile: workspace.overlay,
                    base: base_dt,
                    bindings,
                    identifier: `${node_identifier}/${property_name}`,
                    path: child_path,
                };
                const missing = await missing_required_of(child);
                const response = async (): Promise<UpdateChildResponse> => ({
                    ok: true,
                    message,
                    severity: "info",
                    path: child_path.split("/").filter(Boolean),
                    missing_required: await describe_missing(child, missing),
                });
                if (quiet || session.prompter === undefined) {
                    return answer<UpdateResponse>(response, () => [message, ...missing_lines(child.identifier, missing)].join("\n"));
                }
                // On a terminal: fill the pinned values, then ask for the rest (no example values for a child).
                session.say(message);
                try {
                    await ask_for_missing(child, missing, session as InteractiveSession);
                } catch (error) {
                    if (!(error instanceof PromptCancelled)) { throw error; }
                    for (const line of missing_lines(child.identifier, await missing_required_of(child))) { session.say(line); }
                }
                return answer<UpdateResponse>(response, "");
            }
            // Fall through to property handling (creates a flag for unknown names)
        }

        const outcome = await apply_update(workspace.overlay, base_dt, bindings, node_identifier, property_name, values, message => { session.warn(message); });
        switch (outcome.kind) {
            case "read": {
                return read_target(session, overlay, { ok: true, value: bindings }, node_identifier, property_name, { quiet });
            }
            case "error": {
                return refuse(outcome.message);
            }
            case "set": {
                const message = outcome.detail === undefined ? outcome.message : `${outcome.message}; ${outcome.detail}`;
                const text = outcome.detail === undefined ? outcome.message : `${outcome.message}\n${outcome.detail}`;
                return answer<UpdateResponse>({ ok: true, message, severity: outcome.warned ? "warn" : "info" }, text);
            }
        }
    },
});

/** Add the child `name` (`channel@0`) under `node_path`, with a reg in the radix the parent's patterns name it in; its path. */
export function create_child_node(overlay: DeviceTreeOverlay, node_path: string, name: string, child_patterns: string[]): string {
    const at = name.indexOf("@");
    const child_name = name.slice(0, at);
    const child_unit = name.slice(at + 1);
    const child_properties: DTProperty[] = [];

    const parsed_addr = parse_unit_address(child_unit, unit_radix(child_patterns, child_name) ?? 16);
    if (parsed_addr !== undefined) {
        const cells = address_cells_of(overlay, node_path);
        child_properties.push(encode_reg_address(parsed_addr, cells.address, cells.size));
        // C3: write #address-cells/#size-cells on parent if missing
        ensure_address_cells(overlay, node_path);
    }

    overlay.ensure_node(node_path)?.children.push(NodeBuilder.new()
        .with_name(child_name)
        .with_unit_address(child_unit)
        .with_label([])
        .with_properties(child_properties.length > 0 ? child_properties : undefined)
        .build());
    return `${node_path === "/" ? "" : node_path}/${name}`;
}

export type UpdateOutcome =
    | { kind: "read" }
    | { kind: "error"; message: string }
    /** `detail` is a second line (the implicit interrupt-parent); `warned` when a warning went to stderr. */
    | { kind: "set"; message: string; detail?: string; warned: boolean };

/**
 * Set a property (or a flag) on a node and write the workfile, or say that
 * the request is a read. Warnings go to `warn` as they come; the rest is
 * returned. Shared by `update` and the interview after `add`.
 */
export async function apply_update(
    workfile: Workfile,
    base_dt: DeviceTree,
    bindings: Bindings,
    node_identifier: string,
    property_name: string,
    value_arguments: readonly string[],
    warn: Warn,
): Promise<UpdateOutcome> {
    const { path: input, tree: overlay } = workfile;
    const { target_reference, found, is_base_target, binding_node, binding_parent, parent_name } =
        resolve_write_target(node_identifier, overlay, base_dt);
    if (found === undefined && !is_base_target) {
        return { kind: "error", message: not_found_message(node_identifier, overlay, base_dt) };
    }

    // Reading or setting a flag says nothing about the schema.
    const { definition: property_definition } = await resolve_property_definition(
        binding_node, binding_parent, parent_name, base_dt, bindings,
        property_name, value_arguments.length === 0 ? () => {} : warn,
    );

    const hint = shape_hint(property_definition);

    // The node as the base and the overlay together have it, as `read` shows it.
    const node_path = found?.node_path ?? base_dt.locate(target_reference)?.path;
    const existing_property = (node_path === undefined ? undefined : overlay.effective_node(node_path))
        ?.properties.find(p => p.name === property_name);
    const existing_has_value = existing_property !== undefined && !is_dt_flag(existing_property.value);

    const decision = decide_update(hint, value_arguments, existing_has_value);

    if (typeof decision === "object" && "error" in decision) {
        return { kind: "error", message: `${property_name} ${decision.error}` };
    }

    if (decision === "read") { return { kind: "read" }; }

    if (decision === "set-flag") {
        const built = PropertyBuilder.build_flag().set_flag().with_name(property_name).build();
        place_property(overlay, target_reference, found, is_base_target, built, property_name);
        const printed = workfile.print();
        const test_parse = DeviceTreeOverlay.new_from_string(printed, base_dt);
        if (typeof test_parse === "string") {
            return { kind: "error", message: `Update would produce an unreadable overlay: ${test_parse}` };
        }
        fs.writeFileSync(input, printed);
        return { kind: "set", message: `Set flag ${property_name} on ${node_identifier}`, warned: false };
    }

    // decision === "value"
    const with_value = value_arguments.join(" ");
    const is_label = (name: string): boolean => {
        if (base_dt.node_exists(name)) { return true; }
        return overlay.find_node(name) !== undefined;
    };

    const built = build_raw_property(with_value, property_name, hint, is_label);

    if (built !== null && typeof built === "object" && "error" in built) {
        return { kind: "error", message: built.error };
    }

    place_property(overlay, target_reference, found, is_base_target, built, property_name);

    const ip_result = implicit_interrupt_parent(overlay, base_dt, target_reference, found, is_base_target, property_name, built);
    if (ip_result.warning !== undefined) { warn(ip_result.warning); }

    // R10: updating reg renames the node (overlay-added targets only)
    let rename_message = "";
    let reg_path = is_base_target ? base_dt.locate(target_reference)?.path : found?.node_path;
    if (property_name === "reg" && found !== undefined && !is_base_target) {
        const parent_path = found.node_path.split("/").slice(0, -1).join("/") || "/";
        const cells = address_cells_of(overlay, parent_path);
        const effective = overlay.effective_children(parent_path);
        const radix = await child_unit_radix(overlay.effective_node(parent_path), found.node.name, bindings);
        const sync = sync_unit_address_from_reg(found.node, cells.address, effective, radix);
        switch (sync) {
            case "conflict": {
                return { kind: "error", message: "reg update would create a naming conflict; not written" };
            }
            case "renamed": {
                rename_message = `; renamed to ${get_full_node_name(found.node)}`;
                reg_path = parent_path === "/" ? `/${get_full_node_name(found.node)}` : `${parent_path}/${get_full_node_name(found.node)}`;
                break;
            }
            case "not-numeric": {
                warn("reg contains non-numeric cells; node not renamed");
                break;
            }
        }
    } else if (property_name === "reg" && is_base_target) {
        warn("an overlay can't rename a base node; reg written but name unchanged");
    }

    const printed = workfile.print();
    const test_parse = DeviceTreeOverlay.new_from_string(printed, base_dt);

    if (typeof test_parse === "string") {
        return { kind: "error", message: `Update would produce an unreadable overlay: ${test_parse}` };
    }

    fs.writeFileSync(input, printed);

    const reg_warnings = property_name === "reg" && reg_path !== undefined ? node_reg_warnings(overlay, reg_path) : [];
    for (const line of reg_warnings.flatMap(w => reg_warning_lines(w))) { warn(line); }
    // The binding shapes the value but never refuses it: a count it doesn't allow is written, with a warning.
    const count = property_definition === undefined || built === undefined
        ? undefined
        : count_warning(property_name, property_definition.value, value_count(built));
    if (count !== undefined) { warn(count); }

    return {
        kind: "set",
        message: `Set ${property_name} on ${node_identifier}${rename_message}`,
        ...(ip_result.message === undefined ? {} : { detail: ip_result.message }),
        warned: ip_result.warning !== undefined || reg_warnings.length > 0 || count !== undefined,
    };
}

export function implicit_interrupt_parent(
    overlay: DeviceTreeOverlay,
    base_dt: DeviceTree,
    target_reference: DTLabel | DTPath,
    found: FoundNodeResult | undefined,
    is_base_target: boolean,
    property_name: string,
    built: DTProperty | undefined,
): { message?: string; warning?: string } {
    if (property_name !== "interrupts") { return {}; }
    if (built === undefined) { return {}; }

    const node_path = found?.node_path;
    if (node_path === undefined) { return {}; }

    const has_interrupt_parent = found?.node.properties.some(p => p.name === "interrupt-parent") ?? false;
    if (has_interrupt_parent) { return {}; }

    const inherited = effective_interrupt_parent(base_lookup(base_dt), node_path, base_dt);
    if (inherited === undefined) {
        return { warning: `No interrupt-parent inherited for ${node_path}; set one: update ${node_path} interrupt-parent <controller>` };
    }
    if (inherited.label === undefined) {
        return { warning: `Inherited interrupt-parent at ${inherited.from} has no label; cannot write &{/path} in a plugin` };
    }

    const ip_built = PropertyBuilder.build_cell_array()
        .with_tagged_values(PropertyBuilder.tag_label(inherited.label))
        .with_name("interrupt-parent")
        .build();

    place_property(overlay, target_reference, found, is_base_target, ip_built, "interrupt-parent");

    let warning: string | undefined;
    if (inherited.interrupt_cells !== undefined) {
        const row_count = count_interrupt_cells(built);
        if (row_count !== undefined && row_count !== inherited.interrupt_cells) {
            warning = `${inherited.label} has #interrupt-cells = <${inherited.interrupt_cells}> but interrupts has ${row_count} cells; set interrupt-parent explicitly`;
        }
    }

    return {
        message: `Set interrupt-parent = <&${inherited.label}> on ${node_path} (inherited from ${inherited.from})`,
        warning,
    };
}

function count_interrupt_cells(property: DTProperty): number | undefined {
    if (is_dt_flag(property.value)) { return undefined; }
    const first = property.value[0];
    if (first?.kind !== "array") { return undefined; }
    return first.elements.length;
}

function upsert_property(found_node: DTNode, property: DTProperty): void {
    const existing = found_node.properties.find(p => p.name === property.name);
    if (existing === undefined) { found_node.properties.push(property); return; }
    existing.value = structuredClone(property.value);
}

export function place_property(
    overlay: DeviceTreeOverlay,
    target: NodeTarget,
    found: FoundNodeResult | undefined,
    is_base_target: boolean,
    built: DTProperty | undefined,
    property_name: string,
): void {
    if (is_base_target) {
        if (built === undefined) {
            overlay.remove_property(target, property_name);
        } else {
            overlay.add_fragment(target, undefined, built);
        }
        return;
    }

    if (found !== undefined) {
        if (built === undefined) {
            overlay.remove_property(found.node_path, property_name);
        } else {
            upsert_property(overlay.property_node(found.node_path, property_name) ?? found.node, built);
        }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base_dts = `/dts-v1/;
/ {
    soc {
        gpio: gpio@7e200000 {
            compatible = "brcm,bcm2711-gpio";
            gpio-controller;
            #gpio-cells = <2>;
        };
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
        };
    };
};`;

    const empty_overlay = `/dts-v1/;
/plugin/;

/ {
};
`;

    const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

    const parse = (overlay_source: string) => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_source, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return { base, overlay };
    };

    const base_is_label = (name: string): boolean => {
        const { base, overlay } = parse(empty_overlay);
        if (base.node_exists(name)) { return true; }
        return overlay.find_node(name) !== undefined;
    };

    test("decide_update — known flag, no value → set-flag", () => {
        expect(decide_update("flag", [], false)).toBe("set-flag");
    });

    test("decide_update — known non-flag, no value → read", () => {
        expect(decide_update("cells", [], false)).toBe("read");
        expect(decide_update("strings", [], false)).toBe("read");
    });

    test("decide_update — unknown and absent, no value → set-flag", () => {
        expect(decide_update(undefined, [], false)).toBe("set-flag");
    });

    test("decide_update — unknown and present with value, no value → read", () => {
        expect(decide_update(undefined, [], true)).toBe("read");
    });

    test("decide_update — value under flag hint → error", () => {
        const result = decide_update("flag", ["true"], false);
        expect(typeof result).toBe("object");
        expect((result as { error: string }).error).toContain("is a flag");
    });

    test("decide_update — value with any other hint → value", () => {
        expect(decide_update("cells", ["19", "2"], false)).toBe("value");
        expect(decide_update(undefined, ["okay"], false)).toBe("value");
    });

    test("create_child_node - writes reg in the radix the parent's pattern names, returns the child's path", () => {
        const { overlay } = parse(overlay_with_imu);
        const path = "/soc/spi@7e204000/adi,ad7124-8@0";
        expect(create_child_node(overlay, path, "channel@10", ["^channel@([0-9]|1[0-5])$"])).toBe(`${path}/channel@10`);
        const printed = overlay.print();
        expect(printed).toMatch(/channel@10 \{\s*reg = <10>;/);
        expect(printed).toContain("#address-cells = <1>;");
        expect(create_child_node(overlay, path, "port@a", ["^port@[0-9a-f]+$"])).toBe(`${path}/port@a`);
        expect(overlay.print()).toMatch(/port@a \{\s*reg = <10>;/);
    });

    test("place_property - writes a true multi-row matrix as separate <...> groups", () => {
        const { overlay } = parse(empty_overlay);
        const built = build_raw_property("1 2,3 4", "reg", "cells", () => false);
        expect(built).toBeDefined();
        expect("error" in built!).toBe(false);
        place_property(overlay, "spi0", undefined, true, built as DTProperty, "reg");

        const output = overlay.print();
        expect(output).toMatch(/<[^>]*>,\s*<[^>]*>/);
    });

    test("place_property - adds a property to a base node with no fragment yet", () => {
        const { overlay } = parse(empty_overlay);

        expect(overlay.get_fragments().length).toBe(0);

        const built = build_raw_property("5000000", "spi-max-frequency", "cells", () => false);
        expect(built).toBeDefined();
        expect("error" in built!).toBe(false);
        place_property(overlay, "spi0", undefined, true, built as DTProperty, "spi-max-frequency");

        const output = overlay.print();
        expect(output).toContain("spi0");
        expect(output).toContain("spi-max-frequency");
        expect(overlay.get_fragments().length).toBe(1);
    });

    test("place_property - updating a base-node property reuses the fragment", () => {
        const { overlay } = parse(empty_overlay);

        const b1 = build_raw_property("1", "spi-max-frequency", "cells", () => false) as DTProperty;
        const b2 = build_raw_property("2", "spi-max-frequency", "cells", () => false) as DTProperty;
        place_property(overlay, "spi0", undefined, true, b1, "spi-max-frequency");
        place_property(overlay, "spi0", undefined, true, b2, "spi-max-frequency");

        expect(overlay.get_fragments().length).toBe(1);
        expect(overlay.print()).toContain("spi-max-frequency");
    });

    test("place_property - removing a base-node boolean prunes the emptied fragment", () => {
        const { overlay } = parse(empty_overlay);

        const built = PropertyBuilder.build_flag().set_flag().with_name("wakeup-source").build();
        place_property(overlay, "spi0", undefined, true, built, "wakeup-source");
        expect(overlay.get_fragments().length).toBe(1);

        place_property(overlay, "spi0", undefined, true, undefined, "wakeup-source");
        expect(overlay.print()).not.toContain("wakeup-source");
        expect(overlay.get_fragments().length).toBe(0);
    });

    test("place_property - mutates an overlay-added node in place", () => {
        const { overlay } = parse(overlay_with_imu);
        const found = overlay.find_node("imu1");
        expect(found).toBeDefined();

        const built = build_raw_property("0", "reg", "cells", () => false) as DTProperty;
        place_property(overlay, "imu1", found, false, built, "reg");

        const output = overlay.print();
        expect(output).toContain("imu1");
        expect(output).toContain("reg");
    });

}
