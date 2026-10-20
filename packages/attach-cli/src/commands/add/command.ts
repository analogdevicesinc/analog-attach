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
import { load_workspace, parse_overlay, report_config_errors, type Bindings, type Workfile } from "../../config/workspace";
import { bus_kind, find_binding, parse_node_path, resolve_path, type BusKind } from "../../utilities";
import { respond, respond_fail, diagnostic, input_error } from "../../protocol/output";
import type { AddResponse, MissingProperty } from "../../protocol/types";
import { new_workfile, next_workfile_name } from "../../workfile";
import { resolve_target_binding } from "../list/suggest";
import { format_details, format_missing } from "../read/command";
import { apply_update } from "../update/command";
import { node_missing_required, property_details } from "../../node-state";
import { run_interview, type InterviewSteps } from "./interview";
import { node_reg_warnings, reg_warning_lines } from "../../reg-conflicts";

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
        .option("--no-interview", "Don't ask for the missing required properties; just list them")
        .addHelpText("after", `
Examples:
  $ attach-linux add adi,ad7124-8 --parent spi0
  $ attach-linux add invensense,icm42688 --parent spi0 --label imu1
  $ attach-linux add adi,ad7124-8 --parent spi0 --name adc@1

On a terminal, add then asks for each required property that is still
missing, showing the binding's description and suggestions: Enter takes the
first suggestion, - skips one, Ctrl-D stops. Piped runs, --json and
--no-interview list the missing properties instead.

Use 'list device' to find compatible strings, 'list parent' to find valid buses.`)
        .action(async (compatible: string, options: { parent?: string; name?: string; label?: string; interview: boolean }) => {
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
                ? { ok: true as const, value: new_workfile(next_workfile_name(device_name(compatible)), workspace.base.tree, settings.overlay_syntax) }
                : parse_overlay(settings, workspace.base);
            if (!opened.ok) {
                report_config_errors(context_, opened.errors);
                return;
            }
            const workfile = opened.value;

            const binding_path = await find_binding(linux, dtSchema, compatible);
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
            const parent_path = result.path.slice(0, result.path.lastIndexOf("/")) || "/";
            const parent_node = workfile.tree.effective_node(parent_path);
            const added: AddedNode = { ...result, bus: parent_node === undefined ? undefined : bus_kind(parent_node) };
            for (const note of result.notes) {
                const message = note_message(note, added);
                if (context_.json) { diagnostic(message); } else { console.log(message); }
            }
            for (const line of node_reg_warnings(workfile.tree, result.path).flatMap(w => reg_warning_lines(w))) {
                if (context_.json) { diagnostic(line); } else { console.log(line); }
            }

            const bindings = workspace.bindings;
            const missing = await missing_after_add(workfile, workspace.base.tree, bindings, result);
            const added_message = `Added ${result.key} (label: ${result.label})`;
            if (context_.json) {
                const response: AddResponse = {
                    ok: true,
                    message: created_message === undefined ? added_message : `${created_message}; ${added_message}`,
                    severity: "info",
                    key: result.key,
                    path: result.path.split("/").filter(Boolean),
                    missing_required: await describe_missing(workfile, workspace.base.tree, bindings, result.label, missing),
                };
                respond(response);
                return;
            }

            console.log(`${added_message} to ${workfile.path}`);
            const interactive = options.interview && process.stdin.isTTY && process.stdout.isTTY;
            if (!interactive || missing.length === 0) {
                for (const line of missing_lines(result.label, missing)) { console.log(line); }
                return;
            }

            console.log("");
            await run_interview(missing, interview_steps(workfile, workspace.base.tree, bindings, result.label), {
                input: process.stdin,
                output: process.stdout,
                terminal: true,
            });
            console.log("");
            const left = await missing_after_add(workfile, workspace.base.tree, bindings, result);
            const done = left.length === 0 ? ["All required properties are set."] : missing_lines(result.label, left);
            for (const line of done) { console.log(line); }
        });
}

/** The required properties the new node still lacks, in the order to set them. */
async function missing_after_add(workfile: Workfile, base: DeviceTree, bindings: Bindings, added: { path: string; label: string }): Promise<string[]> {
    const { binding } = await resolve_target_binding(added.label, workfile.tree, base, { ok: true, value: bindings });
    return "error" in binding ? [] : node_missing_required(binding, workfile.tree, added.path);
}

/** The missing properties with what the binding says about them, for an AI to ask itself. */
async function describe_missing(workfile: Workfile, base: DeviceTree, bindings: Bindings, label: string, missing: string[]): Promise<MissingProperty[]> {
    const target = await resolve_target_binding(label, workfile.tree, base, { ok: true, value: bindings });
    return missing.map(property => {
        const { info, suggestions } = property_details(target, workfile.tree, base, label, property);
        return {
            property,
            ...(info?.description === undefined ? {} : { description: info.description }),
            suggestions,
        };
    });
}

/** The questions are rebuilt each time, so an answer (interrupt-parent) shapes the next one (interrupts). */
function interview_steps(workfile: Workfile, base: DeviceTree, bindings: Bindings, label: string): InterviewSteps {
    return {
        ask: async (property) => {
            const target = await resolve_target_binding(label, workfile.tree, base, { ok: true, value: bindings });
            const { info, suggestions } = property_details(target, workfile.tree, base, label, property);
            return { property, details: format_details(info, suggestions, { with_type: true }), suggestions };
        },
        apply: async (property, tokens) => {
            const outcome = await apply_update(workfile, base, bindings, label, property, tokens);
            switch (outcome.kind) {
                case "set": { return { ok: true, lines: outcome.detail === undefined ? [outcome.message] : [outcome.message, outcome.detail] }; }
                case "error": { return { ok: false, lines: [outcome.message] }; }
                case "read": { return { ok: false, lines: [`${property} needs a value`] }; }
            }
        },
    };
}

function missing_lines(label: string, missing: string[]): string[] {
    if (missing.length === 0) { return []; }
    return [...format_missing(missing), `Set them with: update ${label} <property> <value>`];
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

/** The node add just created, and the kind of bus it sits on. */
interface AddedNode {
    path: string;
    key: string;
    label: string;
    bus: BusKind | undefined;
}

const ADDRESS_WORD: Record<BusKind, string> = { spi: "chip select", i2c: "address" };

function note_message(note: AddNodeNote, added: AddedNode): string {
    switch (note.kind) {
        case "reg-needed": { return `The parent is memory-mapped; set the address with: update ${added.path} reg <address> <size>`; }
        case "non-hex-unit": { return `Non-hex unit address "${note.unit}"; no reg created`; }
        case "reg-size-zero": { return "reg size set to 0; update reg with the real size"; }
        case "picked-address": {
            // I2C addresses read as 0x48, chip selects as decimal, other units as in the node name (hex).
            const show = (value: bigint): string => {
                if (added.bus === "i2c") { return `0x${value.toString(16)}`; }
                return added.bus === "spi" ? value.toString() : value.toString(16);
            };
            const taken = note.occupants.map(o => `${show(o.address)} by ${o.name}`).join(", ");
            const word = added.bus === undefined ? "unit address" : ADDRESS_WORD[added.bus];
            const name = added.key.includes("@") ? added.key.slice(0, added.key.indexOf("@")) : added.key;
            return `Picked ${word} ${show(BigInt(`0x${note.unit}`))} (taken: ${taken}).\nTo change it: rename ${added.label} ${name}@<n>`;
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

    const added = { path: "/soc/spi@7e204000/adi,ad7124-8@2", key: "adi,ad7124-8@2", label: "ad7124_8" };

    test("note_message — picked chip select on SPI names the taken ones", () => {
        expect(note_message({ kind: "picked-address", unit: "2", occupants: [{ name: "spidev@0", address: 0n }, { name: "spidev@1", address: 1n }] }, { ...added, bus: "spi" }))
            .toBe("Picked chip select 2 (taken: 0 by spidev@0, 1 by spidev@1).\nTo change it: rename ad7124_8 adi,ad7124-8@<n>");
    });

    test("note_message — I2C addresses are hex", () => {
        expect(note_message({ kind: "picked-address", unit: "49", occupants: [{ name: "temp@48", address: 0x48n }] }, { ...added, key: "adi,adt7410@49", label: "adt7410", bus: "i2c" }))
            .toBe("Picked address 0x49 (taken: 0x48 by temp@48).\nTo change it: rename adt7410 adi,adt7410@<n>");
    });

    test("note_message — chip selects are decimal", () => {
        expect(note_message({ kind: "picked-address", unit: "a", occupants: [{ name: "a@9", address: 9n }] }, { ...added, bus: "spi" }))
            .toBe("Picked chip select 10 (taken: 9 by a@9).\nTo change it: rename ad7124_8 adi,ad7124-8@<n>");
    });

    test("note_message — other buses say unit address", () => {
        expect(note_message({ kind: "picked-address", unit: "1", occupants: [{ name: "a@0", address: 0n }] }, { ...added, bus: undefined }))
            .toBe("Picked unit address 1 (taken: 0 by a@0).\nTo change it: rename ad7124_8 adi,ad7124-8@<n>");
    });

    test("missing_lines — the missing list with how to set them, nothing when complete", () => {
        expect(missing_lines("ad7124_8", ["interrupt-parent", "interrupts"])).toEqual([
            "Missing required: interrupt-parent, interrupts",
            "Set them with: update ad7124_8 <property> <value>",
        ]);
        expect(missing_lines("ad7124_8", [])).toEqual([]);
    });
}
