import { Command } from "commander";
import {
    Attach,
    add_node,
    type DeviceTree,
    type DeviceTreeOverlay,
    type AddNodeNote,
    type AddNodeResult,
} from "attach-lib";

import type { LocalContext } from "../../context";
import { load_workspace, parse_overlay, report_config_errors } from "../../config/workspace";
import { find_binding, parse_node_path, resolve_path } from "../../utilities";
import { respond, respond_fail, diagnostic, input_error } from "../../protocol/output";
import type { AddResponse } from "../../protocol/types";
import { new_workfile } from "../../workfile";

export interface AddRequest {
    compatible: string;
    /** Parent identifier (label, path or hybrid); the root when absent. */
    parent?: string;
    name?: string;
    label?: string;
    auto_address: boolean;
}

export function build_add_command(context_: LocalContext): Command {
    return new Command("add")
        .description("Add a device node to the overlay")
        .argument("<compatible>", "Compatible string of the device to add")
        .option("--parent <value>", "Parent node: label, path, or hybrid (e.g. spi0, /soc/spi@7e204000, spi0/adc@2)")
        .option("--name <value>", "Node name override (e.g. adc@0); defaults to the compatible string")
        .option("--label <value>", "Label override (a label is generated automatically)")
        .addHelpText("after", `
Examples:
  $ attach-linux add adi,ad7124-8 --parent spi0
  $ attach-linux add invensense,icm42688 --parent spi0 --label imu1
  $ attach-linux add adi,ad7124-8 --parent spi0 --name adc@1

Use 'list device' to find compatible strings, 'list parent' to find valid buses.`)
        .action(async (compatible: string, options: { parent?: string; name?: string; label?: string }) => {
            const report = (message: string): void => {
                if (context_.json) { respond_fail({ ok: false, message, severity: "error" }); }
                else { console.log(message); }
            };

            let parent = options.parent;
            if (parent !== undefined) {
                const parsed = parse_node_path(parent);
                if (!parsed.ok) {
                    if (context_.json) { input_error(parsed.error); } else { console.log(parsed.error); }
                    return;
                }
                parent = parsed.value;
            }

            const workspace = load_workspace(context_, ["bindings", "base"]);
            if (workspace === undefined) { return; }
            const { linux, dt_schema: dtSchema } = workspace.bindings;
            const { settings } = workspace;

            const created = settings.overlay === undefined;
            const opened = created
                ? { ok: true as const, value: new_workfile(`${device_name(compatible)}.dtso`, workspace.base.tree, settings.overlay_syntax) }
                : parse_overlay(settings, workspace.base);
            if (!opened.ok) {
                report_config_errors(context_, opened.errors);
                return;
            }
            const workfile = opened.value;

            const binding_path = await find_binding(linux, dtSchema, compatible, context_.json);
            if (binding_path === undefined) {
                report(`Failed to find binding for ${compatible}`);
                return;
            }

            const result = add_device(workspace.base.tree, workfile.tree, {
                compatible,
                parent,
                name: options.name,
                label: options.label,
                auto_address: await binding_defines_reg(binding_path, linux, dtSchema),
            });

            if (result.status === "parent-not-found") {
                if (context_.json) { respond_fail({ ok: false, message: `Parent node ${parent} not found`, severity: "error" }); }
                else { console.log(`Couldn't find parent node ${parent} in ${workspace.base.source} or ${workfile.path}`); }
                return;
            }
            if (result.status !== "added") {
                report(failure_message(result, parent ?? "/"));
                return;
            }

            workfile.save();
            const created_message = created ? `Wrote ${workfile.path}` : undefined;
            if (created_message !== undefined && !context_.json) { console.log(created_message); }
            for (const note of result.notes) {
                const message = note_message(note, result.path);
                if (context_.json) { diagnostic(message); } else { console.log(message); }
            }

            const added_message = `Added ${result.key} (label: ${result.label})`;
            if (context_.json) {
                const response: AddResponse = {
                    ok: true,
                    message: created_message === undefined ? added_message : `${created_message}; ${added_message}`,
                    severity: "info",
                    key: result.key,
                    path: result.path.split("/").filter(Boolean),
                };
                respond(response);
            } else {
                console.log(`${added_message} to ${workfile.path}`);
            }
        });
}

/** The compatible without its vendor prefix, used to name a new workfile. */
function device_name(compatible: string): string {
    return compatible.includes(",") ? compatible.slice(compatible.indexOf(",") + 1) : compatible;
}

/** Whether the binding has a `reg` property, i.e. the device needs a unit address. */
async function binding_defines_reg(binding_path: string, linux: string, dtSchema: string): Promise<boolean> {
    try {
        const binding = await Attach.new().parse_binding(binding_path, linux, dtSchema);
        return binding?.parsed_binding.properties.some(p => p.key === "reg") ?? false;
    } catch {
        return false;
    }
}

/** Resolve the parent identifier against the overlay and base, then add the node there. */
export function add_device(base: DeviceTree, overlay: DeviceTreeOverlay, request: AddRequest): AddNodeResult {
    let parent_path = "/";
    if (request.parent !== undefined) {
        const resolved = resolve_path(request.parent, overlay, base);
        const path = resolved.in_overlay?.node_path ?? resolved.in_base?.path;
        if (path === undefined) { return { status: "parent-not-found" }; }
        parent_path = path;
    }

    return add_node(overlay, {
        parent_path,
        name: request.name ?? request.compatible,
        compatible: request.compatible,
        label: request.label,
        auto_address: request.auto_address,
    });
}

function failure_message(result: Exclude<AddNodeResult, { status: "added" | "parent-not-found" }>, parent: string): string {
    switch (result.status) {
        case "empty-unit-address": { return "Empty unit address (name@ is invalid)"; }
        case "invalid-label": { return `Invalid label: ${result.label} (must match [A-Za-z_][A-Za-z0-9_]*)`; }
        case "label-taken": { return `Label ${result.label} is already used by ${result.owner}`; }
        case "duplicate": { return `${parent} already has a child named ${result.key}`; }
    }
}

function note_message(note: AddNodeNote, path: string): string {
    switch (note.kind) {
        case "reg-needed": { return `The parent is memory-mapped; set the address with: update ${path} reg <address> <size>`; }
        case "non-hex-unit": { return `Non-hex unit address "${note.unit}"; no reg created`; }
        case "reg-size-zero": { return "reg size set to 0; update reg with the real size"; }
        case "picked-address": {
            const listing = note.occupants.map(o => `${o.address} ${o.name}`).join(", ");
            return `picked @${note.unit}: ${listing}`;
        }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO } = await import("attach-lib");

    const setup = (): { base: DeviceTree; overlay: DeviceTreeOverlay } => {
        const base = DT.new_from_string(`/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
            spidev@0 {
                reg = <0>;
            };
        };
    };
};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string("/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@4 {\n\t\treg = <4>;\n\t};\n};", base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return { base, overlay };
    };

    const request: AddRequest = { compatible: "adi,ad7124-8", auto_address: true };

    test("add_device — parent by label, by absolute path and by hybrid path", () => {
        const { base, overlay } = setup();
        expect(add_device(base, overlay, { ...request, parent: "spi0" }))
            .toMatchObject({ status: "added", path: "/soc/spi@7e204000/adi,ad7124-8@1" });
        expect(add_device(base, overlay, { ...request, parent: "/soc/spi@7e204000" }))
            .toMatchObject({ status: "added", path: "/soc/spi@7e204000/adi,ad7124-8@2" });
        expect(add_device(base, overlay, { ...request, parent: "spi0/adc@4", name: "channel@0", auto_address: false }))
            .toMatchObject({ status: "added", path: "/soc/spi@7e204000/adc@4/channel@0" });
    });

    test("add_device — no parent adds under the root", () => {
        const { base, overlay } = setup();
        expect(add_device(base, overlay, { compatible: "regulator-fixed", auto_address: false }))
            .toMatchObject({ status: "added", path: "/regulator-fixed" });
    });

    test("add_device — unknown parent", () => {
        const { base, overlay } = setup();
        expect(add_device(base, overlay, { ...request, parent: "i2c0" })).toEqual({ status: "parent-not-found" });
    });

    test("note_message — picked address lists the occupants", () => {
        expect(note_message({ kind: "picked-address", unit: "2", occupants: [{ name: "spidev@0", address: 0n }, { name: "spidev@1", address: 1n }] }, "/x"))
            .toBe("picked @2: 0 spidev@0, 1 spidev@1");
    });
}
