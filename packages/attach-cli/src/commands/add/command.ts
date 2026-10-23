import path from "node:path";

import { Command } from "commander";
import {
    Attach,
    Result,
    add_node,
    unresolved_references,
    type DeviceTree,
    type DeviceTreeOverlay,
    type AddNodeNote,
    type AddNodeResult,
    type ParsedBinding,
} from "attach-lib";

import type { LocalContext } from "../../context";
import { load_workspace, parse_overlay, report_config_errors, type Bindings } from "../../config/workspace";
import type { Settings } from "../../config/settings";
import { bus_kind, find_binding, get_or_build_compat_index, parse_node_path, resolve_path, type BusKind } from "../../utilities";
import { respond, respond_fail, diagnostic, input_error } from "../../protocol/output";
import type { AddResponse } from "../../protocol/types";
import { new_workfile, next_workfile_name } from "../../workfile";
import { ask_for_missing, describe_missing, missing_required_of, type NewNode } from "../../missing-required";
import { node_reg_warnings, reg_warning_lines } from "../../reg-conflicts";
import { reference_lines, unique_references } from "../../unresolved";
import {
    choose_example,
    copy_example_node,
    example_bus,
    find_in_example,
    parse_example,
    type ExampleMatch,
    type ExampleNote,
} from "./example";

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
        .option("--from-example", "Copy the node from the binding's example for the parent's bus")
        .option("--no-interview", "Don't ask for the missing required properties; just list them")
        .addHelpText("after", `
Examples:
  $ attach-linux add adi,ad7124-8 --parent spi0
  $ attach-linux add invensense,icm42688 --parent spi0 --label imu1
  $ attach-linux add adi,ad7124-8 --parent spi0 --name adc@1
  $ attach-linux add adi,ad7124-8 --parent spi0 --from-example

--from-example copies the node from the binding's examples: the first one on
the parent's bus (SPI or I2C), else the first one with the device. Name, reg
and references stay as in the example; references that name nothing in the
base or overlay are listed as errors to fix with update.

On a terminal, add then asks for each required property that is still
missing, showing the binding's description and suggestions: Enter takes the
first suggestion, - skips one, Ctrl-D stops. Options (an enum, the nodes a
phandle can name) are numbered: type the number, or the value. A fixed-size
array (diff-channels, interrupts) is asked one entry per line. Piped runs,
--json and --no-interview list the missing properties instead.

Use 'list device' to find compatible strings, 'list parent' to find valid buses.`)
        .action(async (compatible: string, options: { parent?: string; name?: string; label?: string; fromExample?: boolean; interview: boolean }) => {
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

            const from_example = options.fromExample === true;
            if (from_example && options.name !== undefined) {
                report("--name doesn't apply with --from-example: the node keeps the example's name (rename it afterwards)");
                return;
            }
            const request = { compatible, parent, label: options.label };
            const result = from_example
                ? await add_from_example(workfile.tree, workspace.base.tree, settings, workspace.bindings, binding_path, request)
                : add_by_hand(workspace.base.tree, workfile.tree, {
                    ...request,
                    name: options.name,
                    auto_address: await binding_defines_reg(binding_path, linux, dtSchema),
                });

            if (result.status === "parent-not-found") {
                if (context_.json) { respond_fail({ ok: false, message: `Parent node ${parent} not found`, severity: "error" }); }
                else { console.log(`Couldn't find parent node ${parent} in ${workspace.base.source} or ${workfile.path}`); }
                return;
            }
            if (result.status === "failed") {
                report(result.message);
                return;
            }

            workfile.save();
            const created_message = created ? `Wrote ${workfile.path}` : undefined;
            if (created_message !== undefined && !context_.json) { console.log(created_message); }
            const parent_path = result.path.slice(0, result.path.lastIndexOf("/")) || "/";
            const parent_node = workfile.tree.effective_node(parent_path);
            const added: AddedNode = { ...result, bus: parent_node === undefined ? undefined : bus_kind(parent_node) };
            for (const message of result.messages(added)) {
                if (context_.json) { diagnostic(message); } else { console.log(message); }
            }
            for (const line of node_reg_warnings(workfile.tree, result.path).flatMap(w => reg_warning_lines(w))) {
                if (context_.json) { diagnostic(line); } else { console.log(line); }
            }
            const unresolved = from_example ? unique_references(unresolved_references(workfile.tree, result.path)) : [];
            if (!context_.json) {
                for (const line of reference_lines("error", unresolved, workfile.tree.all_labels())) { console.log(line); }
            }

            const added_node: NewNode = {
                workfile,
                base: workspace.base.tree,
                bindings: workspace.bindings,
                identifier: result.label,
                path: result.path,
            };
            const missing = await missing_required_of(added_node);
            const added_message = `Added ${result.key} (label: ${result.label})`;
            if (context_.json) {
                const response: AddResponse = {
                    ok: true,
                    message: created_message === undefined ? added_message : `${created_message}; ${added_message}`,
                    severity: "info",
                    key: result.key,
                    path: result.path.split("/").filter(Boolean),
                    missing_required: await describe_missing(added_node, missing),
                    ...(from_example
                        ? { unresolved: unresolved.map(u => ({ path: u.path.split("/").filter(Boolean), property: u.property, reference: u.reference })) }
                        : {}),
                };
                respond(response);
                return;
            }

            console.log(`${added_message} to ${workfile.path}`);
            await ask_for_missing(added_node, missing, { interview: options.interview });
        });
}

/** The compatible without its vendor prefix, used to name a new workfile. */
function device_name(compatible: string): string {
    return compatible.includes(",") ? compatible.slice(compatible.indexOf(",") + 1) : compatible;
}

async function parse_binding(binding_path: string, linux: string, dtSchema: string): Promise<ParsedBinding | undefined> {
    try {
        const result = await Attach.parse(binding_path, { linux, dt_schema: dtSchema });
        return Result.is_ok(result) ? result.value.parsed_binding : undefined;
    } catch {
        return undefined;
    }
}

/** Whether the binding has a `reg` property, i.e. the device needs a unit address. */
async function binding_defines_reg(binding_path: string, linux: string, dtSchema: string): Promise<boolean> {
    const binding = await parse_binding(binding_path, linux, dtSchema);
    return binding?.properties.some(p => p.key === "reg") ?? false;
}

/** What add did: the new node and the notes to print about it (worded for its bus), or why it didn't. */
type AddOutcome =
    | { status: "added"; key: string; path: string; label: string; messages: (added: AddedNode) => string[] }
    | { status: "parent-not-found" }
    | { status: "failed"; message: string };

function add_by_hand(base: DeviceTree, overlay: DeviceTreeOverlay, request: AddRequest): AddOutcome {
    const result = add_device(base, overlay, request);
    if (result.status === "parent-not-found") { return result; }
    if (result.status !== "added") { return { status: "failed", message: failure_message(result, request.parent ?? "/") }; }
    return { ...result, messages: added => result.notes.map(note => note_message(note, added)) };
}

/** Copy the device's node from the binding example that best fits the parent's bus. */
async function add_from_example(
    overlay: DeviceTreeOverlay,
    base: DeviceTree,
    settings: Settings,
    bindings: Bindings,
    binding_path: string,
    request: { compatible: string; parent?: string; label?: string },
): Promise<AddOutcome> {
    const parent_path = resolve_parent_path(base, overlay, request.parent);
    if (parent_path === undefined) { return { status: "parent-not-found" }; }

    const file = path.basename(binding_path);
    const binding = await parse_binding(binding_path, bindings.linux, bindings.dt_schema);
    const examples = binding?.examples ?? [];
    // An example may show another device of the same binding (adi,ad7124-4 for adi,ad7124-8).
    const index = await get_or_build_compat_index(bindings);
    const belongs = (candidate: string): boolean => candidate === request.compatible || index.entries[candidate] === binding_path;
    const matches: ExampleMatch[] = [];
    const broken: string[] = [];
    for (const [position, example] of examples.entries()) {
        const root = parse_example(example, settings, bindings.linux);
        if (typeof root === "string") {
            broken.push(`example ${position + 1} doesn't compile: ${root.split("\n")[0] ?? ""}`);
            continue;
        }
        const found = find_in_example(root, belongs);
        if (found !== undefined) { matches.push({ index: position + 1, node: found.node, bus: example_bus(found.wrapper) }); }
    }

    const parent_node = overlay.effective_node(parent_path);
    const bus = parent_node === undefined ? undefined : bus_kind(parent_node);
    const chosen = choose_example(matches, bus);
    if (chosen === undefined) {
        const why = examples.length === 0 ? `${file} has no examples` : `No example in ${file} has a node for ${request.compatible}`;
        return { status: "failed", message: [why, ...broken].join("\n") };
    }

    const copied = copy_example_node(overlay, parent_path, chosen.match.node, request);
    if (copied.status === "parent-not-found") { return copied; }
    if (copied.status !== "added") { return { status: "failed", message: failure_message(copied, request.parent ?? "/") }; }
    const messages = [
        example_choice_message(chosen, bus, request.compatible, file),
        ...copied.notes.map(note => example_note_message(note, request.compatible)),
    ];
    return { ...copied, messages: () => messages };
}

/** The absolute path of the parent identifier, in the overlay or the base; the root when absent. */
function resolve_parent_path(base: DeviceTree, overlay: DeviceTreeOverlay, parent: string | undefined): string | undefined {
    if (parent === undefined) { return "/"; }
    const resolved = resolve_path(parent, overlay, base);
    return resolved.in_overlay?.node_path ?? resolved.in_base?.path;
}

/** Resolve the parent identifier against the overlay and base, then add the node there. */
export function add_device(base: DeviceTree, overlay: DeviceTreeOverlay, request: AddRequest): AddNodeResult {
    const parent_path = resolve_parent_path(base, overlay, request.parent);
    if (parent_path === undefined) { return { status: "parent-not-found" }; }

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
const BUS_NAME: Record<BusKind, string> = { spi: "SPI", i2c: "I2C" };

function example_choice_message(chosen: { match: ExampleMatch; fits: boolean }, bus: BusKind | undefined, compatible: string, file: string): string {
    const { index, bus: example_bus } = chosen.match;
    const on = example_bus === undefined ? "" : ` (${example_bus})`;
    if (chosen.fits || bus === undefined) { return `Copied example ${index} of ${file}${on}`; }
    return `No ${BUS_NAME[bus]} example for ${compatible}; using example ${index}${on}`;
}

function example_note_message(note: ExampleNote, compatible: string): string {
    switch (note.kind) {
        case "compatible-replaced": { return `The example is for ${note.from}; compatible set to ${compatible}`; }
        case "label-renamed": { return `Label ${note.from} is taken; labelled ${note.to} instead`; }
    }
}

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

    test("example_choice_message — the bus matched, didn't, or isn't known", () => {
        const match = (bus?: BusKind): ExampleMatch => ({ index: 2, node: { labels: [], name: "adc", unit_addr: undefined, properties: [], children: [] }, bus });
        expect(example_choice_message({ match: match("spi"), fits: true }, "spi", "adi,ad7124-8", "adi,ad7124.yaml"))
            .toBe("Copied example 2 of adi,ad7124.yaml (spi)");
        expect(example_choice_message({ match: match("i2c"), fits: false }, "spi", "adi,ad7124-8", "adi,ad7124.yaml"))
            .toBe("No SPI example for adi,ad7124-8; using example 2 (i2c)");
        expect(example_choice_message({ match: match(), fits: false }, "i2c", "adi,ad7124-8", "adi,ad7124.yaml"))
            .toBe("No I2C example for adi,ad7124-8; using example 2");
        expect(example_choice_message({ match: match(), fits: true }, undefined, "adi,ad7124-8", "adi,ad7124.yaml"))
            .toBe("Copied example 2 of adi,ad7124.yaml");
    });

    test("example_note_message", () => {
        expect(example_note_message({ kind: "compatible-replaced", from: "adi,ad7124-4" }, "adi,ad7124-8"))
            .toBe("The example is for adi,ad7124-4; compatible set to adi,ad7124-8");
        expect(example_note_message({ kind: "label-renamed", from: "adc", to: "adc_1" }, "adi,ad7124-8"))
            .toBe("Label adc is taken; labelled adc_1 instead");
    });

}
