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
import { bus_kind, find_binding, parse_node_path, resolve_path, type BusKind } from "../../utilities";
import { respond, respond_fail, diagnostic, input_error } from "../../protocol/output";
import type { AddResponse } from "../../protocol/types";
import { new_workfile, next_workfile_name } from "../../workfile";
import { ask_for_missing, describe_missing, missing_required_of, type NewNode } from "../../missing-required";
import { node_reg_warnings, reg_warning_lines } from "../../reg-conflicts";
import { reference_lines, unique_references } from "../../unresolved";
import { binding_examples, copy_example_node, device_matcher, find_examples, pick_example, type ExampleMatch, type ExampleNote } from "./example";
import { load_overlay_template, type OverlayTemplate } from "./overlay-template";
import { default_parent, pick_parent, target_bus, type DefaultParent } from "./parent";
import { parse_template, template_text, type Template } from "./template";

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
        .option("--template <template>", "What to start the node from: required (default), example:<N> or overlay:<name>")
        .option("--quiet", "Don't ask for the missing required properties; just list them")
        .addHelpText("after", `
Examples:
  $ attach-linux add adi,ad7124-8 --parent spi0
  $ attach-linux add invensense,icm42688 --parent spi0 --label imu1
  $ attach-linux add adi,ad7124-8 --parent spi0 --name adc@1
  $ attach-linux add adi,ad7124-8 --parent spi0 --template example:2
  $ attach-linux add adi,ad7124-8 --template overlay:rpi-ad7124-8-all-diff

--template says what the node starts from:
  required         (the default) a bare node, then the interview below
  example:<N>      the node of the binding's example N (its position in the
                   binding's examples), as written: name, reg, children and
                   references. An example for another device of the binding gets
                   the requested compatible. The bus of the example is shown;
                   with --parent on another bus it is used all the same.
  overlay:<name>   the node and its children from an overlay of the Linux tree
                   (a name from 'list overlay', a stem, or a file path), nothing
                   else of the overlay. Without --parent it goes where the
                   overlay's fragment puts it (its target; a target the
                   base lacks gets the first valid bus of its kind).
The copied kinds never ask: references that name nothing in the base or overlay
are listed as errors to fix with update, then the missing required properties.
--name doesn't apply to them (rename afterwards); --label does.

On a terminal, add then asks for each required property that is still
missing, showing the binding's description and suggestions: Enter takes the
first suggestion, - skips one, Ctrl-D stops. Options (an enum, the nodes a
phandle can name) are lettered a, b, c, ...: type the letter, or the value
(&label or "text" when the value itself looks like a letter). A fixed-size
array (diff-channels, interrupts) is asked one entry per line. Piped runs,
--json and --quiet list the missing properties instead (--template required only).

Use 'list device' to find compatible strings, 'list parent' to find valid buses.`)
        .action(async (compatible: string, options: { parent?: string; name?: string; label?: string; template?: string; quiet?: boolean }) => {
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

            const template = parse_template(options.template ?? "required");
            if (typeof template === "string") {
                if (context_.json) { input_error(template); } else { console.log(template); }
                return;
            }
            const copies = template.kind !== "required";
            if (copies && options.name !== undefined) {
                report(`--name doesn't apply with --template ${template_text(template)}: the node keeps its name (rename it afterwards)`);
                return;
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

            const result = await add_with_template(template, {
                overlay: workfile.tree,
                base: workspace.base.tree,
                settings,
                bindings: workspace.bindings,
                binding_path,
                request: { compatible, parent, label: options.label, name: options.name },
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
            const unresolved = copies ? unique_references(unresolved_references(workfile.tree, result.path)) : [];
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
                    template: template_text(template),
                    missing_required: await describe_missing(added_node, missing),
                    ...(copies
                        ? { unresolved: unresolved.map(u => ({ path: u.path.split("/").filter(Boolean), property: u.property, reference: u.reference })) }
                        : {}),
                };
                respond(response);
                return;
            }

            console.log(`${added_message} to ${workfile.path}`);
            await ask_for_missing(added_node, missing, { interview: !copies && options.quiet !== true });
        });
}

/** The compatible without its vendor prefix, used to name a new workfile. */
function device_name(compatible: string): string {
    return compatible.includes(",") ? compatible.slice(compatible.indexOf(",") + 1) : compatible;
}

async function parse_binding(binding_path: string, bindings: Bindings): Promise<ParsedBinding | undefined> {
    try {
        const result = await Attach.parse(binding_path, bindings);
        return Result.is_ok(result) ? result.value.parsed_binding : undefined;
    } catch {
        return undefined;
    }
}

/** Whether the binding has a `reg` property, i.e. the device needs a unit address. */
async function binding_defines_reg(binding_path: string, bindings: Bindings): Promise<boolean> {
    const binding = await parse_binding(binding_path, bindings);
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

interface TemplateInput {
    overlay: DeviceTreeOverlay;
    base: DeviceTree;
    settings: Settings;
    bindings: Bindings;
    binding_path: string;
    request: Omit<AddRequest, "auto_address">;
}

/** Add the device the way the template says: by hand, or copied from an example or an overlay. */
async function add_with_template(template: Template, input: TemplateInput): Promise<AddOutcome> {
    const { overlay, base, binding_path, bindings, request } = input;
    switch (template.kind) {
        case "required": {
            return add_by_hand(base, overlay, { ...request, auto_address: await binding_defines_reg(binding_path, bindings) });
        }
        case "example": { return add_from_example(input, template.index); }
        case "overlay": { return add_from_overlay(input, template.name); }
    }
}

/** Copy the device's node from example `index` of its binding. */
async function add_from_example(input: TemplateInput, index: number): Promise<AddOutcome> {
    const { overlay, base, settings, bindings, binding_path, request } = input;
    const parent_path = resolve_parent_path(base, overlay, request.parent);
    if (parent_path === undefined) { return { status: "parent-not-found" }; }

    const file = path.basename(binding_path);
    const search = find_examples(await binding_examples(binding_path, bindings), device_matcher(bindings, binding_path, request.compatible), settings, bindings.linux);
    const picked = pick_example(search, index, request.compatible, file);
    if (typeof picked === "string") { return { status: "failed", message: picked }; }

    const parent_node = overlay.effective_node(parent_path);
    const bus = parent_node === undefined ? undefined : bus_kind(parent_node);
    const copied = copy_example_node(overlay, parent_path, picked.node, request);
    if (copied.status === "parent-not-found") { return copied; }
    if (copied.status !== "added") { return { status: "failed", message: failure_message(copied, request.parent ?? "/") }; }
    const messages = [
        ...example_messages(picked, bus, file),
        ...copied.notes.map(note => copy_note_message(note, request.compatible, "example")),
    ];
    return { ...copied, messages: () => messages };
}

/** Copy the device's node, with its children, from an overlay of the Linux tree. */
async function add_from_overlay(input: TemplateInput, name: string): Promise<AddOutcome> {
    const { overlay, base, settings, bindings, binding_path, request } = input;
    const found = load_overlay_template(name, request.compatible, device_matcher(bindings, binding_path, request.compatible), settings, bindings.linux, base);
    if (found.status === "failed") { return { status: "failed", message: found.message }; }

    // Without --parent: the node its fragment targets; when the base lacks that, the first valid parent of the target's bus kind.
    let placed: DefaultParent | undefined;
    if (request.parent === undefined && found.parent === undefined) {
        const binding = await parse_binding(binding_path, bindings);
        const bus = target_bus(found.target);
        placed = binding === undefined ? pick_parent(base, [], bus) : default_parent(base, binding, bus);
    }
    const parent_path = request.parent === undefined ? found.parent ?? placed?.path ?? "/" : resolve_parent_path(base, overlay, request.parent);
    if (parent_path === undefined) { return { status: "parent-not-found" }; }
    const copied = copy_example_node(overlay, parent_path, found.match.node, request);
    if (copied.status === "parent-not-found") { return copied; }
    if (copied.status !== "added") { return { status: "failed", message: failure_message(copied, request.parent ?? (placed === undefined ? found.place : placed.label ?? placed.path)) }; }

    return { ...copied, messages: () => overlay_messages(found, request, copied.label, copied.notes, placed) };
}

/** What add says about a node copied from an overlay: where from, the nodes left, the board, a target the base lacks (`placed` is where it went instead), label changes. */
function overlay_messages(
    found: Extract<OverlayTemplate, { status: "found" }>,
    request: { compatible: string; parent?: string },
    label: string,
    notes: ExampleNote[],
    placed?: DefaultParent,
): string[] {
    const more = found.others.length;
    return [
        `Copied ${found.node_path} from ${found.dormant ? "a dormant fragment of " : ""}${found.shown}`,
        ...(more === 0 ? [] : [`The overlay has ${more} more ${more === 1 ? "node" : "nodes"} for ${request.compatible}, not copied: ${found.others.join(", ")}`]),
        ...found.board,
        ...(request.parent === undefined && found.parent === undefined && placed !== undefined ? [target_missing_warning(found.place, placed, label)] : []),
        ...notes.map(note => copy_note_message(note, request.compatible, "overlay's node")),
    ];
}

/** The overlay's target isn't in the base: where the node went instead, and why that parent. */
function target_missing_warning(place: string, placed: DefaultParent, label: string): string {
    const lead = `warning: the overlay puts it in ${place}, which the base doesn't have;`;
    if (placed.path === "/") { return `${lead} the node is under / (move it with: move ${label} <parent>)`; }
    const shown = placed.label ?? placed.path;
    if (placed.requested === undefined) { return `${lead} using ${shown} (the first valid parent)`; }
    return placed.fits
        ? `${lead} using ${shown} (first ${BUS_NAME[placed.requested]} bus)`
        : `${lead} using ${shown} (no ${BUS_NAME[placed.requested]} bus; the first valid parent)`;
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

/** The copied example, and a note when its bus isn't the parent's. */
function example_messages(match: ExampleMatch, bus: BusKind | undefined, file: string): string[] {
    const on = match.bus === undefined ? "" : ` (${match.bus})`;
    const lines = [`Copied example ${match.index} of ${file}${on}`];
    if (bus !== undefined && match.bus !== undefined && bus !== match.bus) {
        lines.push(`Example ${match.index} is on ${BUS_NAME[match.bus]}; the parent is ${BUS_NAME[bus]}`);
    }
    return lines;
}

/** What copying changed in the node: `what` names where it came from (`example`, `overlay's node`). */
function copy_note_message(note: ExampleNote, compatible: string, what: string): string {
    switch (note.kind) {
        case "compatible-replaced": { return `The ${what} is for ${note.from}; compatible set to ${compatible}`; }
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

    test("example_messages — the example, and a note when its bus isn't the parent's", () => {
        const match = (bus?: BusKind): ExampleMatch => ({ index: 2, node: { labels: [], name: "adc", unit_addr: undefined, properties: [], children: [] }, bus });
        expect(example_messages(match("spi"), "spi", "adi,ad7124.yaml")).toEqual(["Copied example 2 of adi,ad7124.yaml (spi)"]);
        expect(example_messages(match("i2c"), "spi", "adi,ad7124.yaml"))
            .toEqual(["Copied example 2 of adi,ad7124.yaml (i2c)", "Example 2 is on I2C; the parent is SPI"]);
        expect(example_messages(match(), "i2c", "adi,ad7124.yaml")).toEqual(["Copied example 2 of adi,ad7124.yaml"]);
        expect(example_messages(match("spi"), undefined, "adi,ad7124.yaml")).toEqual(["Copied example 2 of adi,ad7124.yaml (spi)"]);
    });

    test("overlay_messages — the source, the others left behind, the board, a target the base lacks", () => {
        const node = { labels: [], name: "adc", unit_addr: "0", properties: [], children: [] };
        const found: Extract<OverlayTemplate, { status: "found" }> = {
            status: "found",
            shown: "arch/arm/boot/dts/overlays/ad7124-overlay.dts",
            match: { node, fragment: { ...node, name: "fragment" }, chain: [], dormant: false },
            target: "spi7",
            place: "spi7",
            node_path: "spi7/adc@0",
            dormant: false,
            parent: undefined,
            others: ["spi7/adc@1", "spi7/adc@2"],
            board: ["warning: this overlay is for another board: xlnx,zynqmp", "  (base: brcm,bcm2711)"],
        };
        const first_spi: DefaultParent = { path: "/soc/spi@7e204000", label: "spi", requested: "spi", fits: true };
        expect(overlay_messages(found, { compatible: "adi,ad7124-8" }, "ad7124", [{ kind: "compatible-replaced", from: "adi,ad7124-4" }], first_spi)).toEqual([
            "Copied spi7/adc@0 from arch/arm/boot/dts/overlays/ad7124-overlay.dts",
            "The overlay has 2 more nodes for adi,ad7124-8, not copied: spi7/adc@1, spi7/adc@2",
            "warning: this overlay is for another board: xlnx,zynqmp",
            "  (base: brcm,bcm2711)",
            "warning: the overlay puts it in spi7, which the base doesn't have; using spi (first SPI bus)",
            "The overlay's node is for adi,ad7124-4; compatible set to adi,ad7124-8",
        ]);
        // With --parent, or a target the base has, there is nothing to warn about.
        expect(overlay_messages({ ...found, others: ["spi7/adc@1"], board: [] }, { compatible: "adi,ad7124-8", parent: "spi0" }, "ad7124", [], first_spi))
            .toEqual(["Copied spi7/adc@0 from arch/arm/boot/dts/overlays/ad7124-overlay.dts", "The overlay has 1 more node for adi,ad7124-8, not copied: spi7/adc@1"]);
        expect(overlay_messages({ ...found, others: [], board: [], parent: "/soc/spi@7e204000", target: "spi0", place: "spi0", node_path: "spi0/adc@0" }, { compatible: "adi,ad7124-8" }, "ad7124", []))
            .toEqual(["Copied spi0/adc@0 from arch/arm/boot/dts/overlays/ad7124-overlay.dts"]);
    });

    test("target_missing_warning — the kind found, no bus of the kind, no kind, no parent at all", () => {
        const place = "spi7";
        expect(target_missing_warning(place, { path: "/soc/spi@7e204000", label: "spi", requested: "spi", fits: true }, "ad7124"))
            .toBe("warning: the overlay puts it in spi7, which the base doesn't have; using spi (first SPI bus)");
        expect(target_missing_warning(place, { path: "/soc/spi@7e204000", label: undefined, requested: "i2c", fits: false }, "ad7124"))
            .toBe("warning: the overlay puts it in spi7, which the base doesn't have; using /soc/spi@7e204000 (no I2C bus; the first valid parent)");
        expect(target_missing_warning(place, { path: "/soc/i2c@7e804000", label: "i2c1", requested: undefined, fits: true }, "ad7124"))
            .toBe("warning: the overlay puts it in spi7, which the base doesn't have; using i2c1 (the first valid parent)");
        expect(target_missing_warning(place, { path: "/", label: undefined, requested: "spi", fits: false }, "ad7124"))
            .toBe("warning: the overlay puts it in spi7, which the base doesn't have; the node is under / (move it with: move ad7124 <parent>)");
    });

    test("overlay_messages — a node from a dormant fragment says so", () => {
        const node = { labels: [], name: "adc", unit_addr: "0", properties: [], children: [] };
        const found: Extract<OverlayTemplate, { status: "found" }> = {
            status: "found", shown: "x-overlay.dts", match: { node, fragment: { ...node, name: "fragment" }, chain: [], dormant: true },
            target: "spi0", place: "spi0", node_path: "spi0/adc@0", dormant: true, parent: "/soc/spi@7e204000", others: [], board: [],
        };
        expect(overlay_messages(found, { compatible: "adi,ad7124-8" }, "ad7124", [])).toEqual(["Copied spi0/adc@0 from a dormant fragment of x-overlay.dts"]);
    });

    test("copy_note_message", () => {
        expect(copy_note_message({ kind: "compatible-replaced", from: "adi,ad7124-4" }, "adi,ad7124-8", "example"))
            .toBe("The example is for adi,ad7124-4; compatible set to adi,ad7124-8");
        expect(copy_note_message({ kind: "compatible-replaced", from: "adi,ad7124-4" }, "adi,ad7124-8", "overlay's node"))
            .toBe("The overlay's node is for adi,ad7124-4; compatible set to adi,ad7124-8");
        expect(copy_note_message({ kind: "label-renamed", from: "adc", to: "adc_1" }, "adi,ad7124-8", "example"))
            .toBe("Label adc is taken; labelled adc_1 instead");
    });

}
