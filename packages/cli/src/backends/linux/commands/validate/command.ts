import {
	DeviceTree,
	DeviceTreeOverlay,
	is_dt_flag,
	cell_extract_first_value,
	get_full_node_name,
	print_property,
	reference_resolver,
	unresolved_in,
	type DTNode,
	type DTProperty,
	type DTLabel,
	type DTPath,
} from "linux-lib";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import { answer, command, refuse, validation_header, type FlagSpecs, type Outcome, type Session } from "../../../../interface/backend-interface";
import type { ErrorType } from "../../../../interface/error-types";
import { load_workspace, type Bindings, type Workspace } from "../../config/workspace";
import { write_full_devicetree } from "../../full-devicetree";
import { display_path, reference_finding, target_finding, unique_references, type Finding } from "../../unresolved";
import { is_tool_available, resolve_write_target } from "../../utilities";
import type { UnresolvedTargetEntry, ValidationResponse, ValidationError } from "../../protocol/types";
import { reg_warnings, type RegWarning } from "../../reg-conflicts";
import { disabled_parent_warnings, type DisabledParentWarning } from "../../disabled-parent";
import { has_negative, unsigned_finding } from "../../value-check";
import { resolve_property_definition } from "../update/command";
import { validation_subset } from "./schema-subset";
import { validate_with_worker, worker_owner } from "./worker";
import { is_touched, touched_by } from "./touched";

/** A validation that stopped before dt-validate had its say: a refusal with the tool's error. */
function tool_failure(message: string, text: string): Outcome<ValidationResponse> {
	return refuse(message, { type: "tool-failed", text });
}

const VALIDATE_FLAGS = {
	full: { kind: "boolean", brief: "Also check the overlay merged with the base devicetree" },
} as const satisfies FlagSpecs;

/**
 * What the full devicetree gets after the overlay's blocks for dt-validate:
 * dt-schema's gpio fixup crashes on a Raspberry Pi's `/aliases`, and
 * `/__overrides__` refers to it, so neither is checked.
 */
const FULL_EPILOGUE = "\n/ {\n\t/delete-node/ aliases;\n\t/delete-node/ __overrides__;\n};\n";

type Checked = Workspace<"bindings" | "tools" | "base" | "overlay">;

export const validate = command<Record<never, never>, ValidationResponse, typeof VALIDATE_FLAGS>({
	flags: VALIDATE_FLAGS,
	docs: {
		brief: "Validate the overlay against its bindings",
		full: "Runs dt-validate on the nodes the overlay writes. With --full, also on the base devicetree with the overlay applied, reporting what the overlay adds or sets and counting the base's own findings.",
		examples: ["validate", "validate --full", "--json validate"],
	},
	async run(_arguments, flags, session) {
		const loaded = load_workspace(session, ["bindings", "tools", "base", "overlay"]);
		if (!loaded.ok) { return loaded.outcome; }
		const { workspace } = loaded;
		const overlay = workspace.overlay.tree;
		const work_directory = session.state_dir;
		fs.mkdirSync(work_directory, { recursive: true });
		const temporary_dts = path.join(work_directory, "temp.dts");
		const tree = build_validation_tree(overlay);
		fs.writeFileSync(temporary_dts, tree.source);

		const found = await check(workspace, temporary_dts, path.join(work_directory, "temp.dtb"), path.join(work_directory, "error.json"), at => tree.nodes.has(at), work_directory);
		if (!Array.isArray(found)) { return found; }
		// Those about the CLI's stand-ins are left out (VALIDATE-007), and so is a repeat (VALIDATE-008).
		const diagnostics = unique_findings(found.filter(d => d.node === undefined || !tree.stubs.has(d.node)));

		// dt-validate checks each node on its own; sibling reg clashes are checked here, and so are the negatives
		// dtc stores wrapped, which dt-validate only sees as the number stored, the devices on a disabled parent,
		// and the targets and references that name no node, which dtc takes in an overlay as fixups.
		const reg = [
			...reg_diagnostics(reg_warnings(overlay)),
			...await unsigned_diagnostics(overlay, workspace.base.tree, workspace.bindings),
			...parent_diagnostics(disabled_parent_warnings(overlay)),
			...target_diagnostics(overlay),
			...reference_diagnostics(overlay),
		];
		const display = validation_display(overlay);
		if (flags.full !== true) {
			const all = [...diagnostics, ...reg];
			return answer(
				() => parse_dt_validate_output(all),
				() => format_validation_report(all, display).join("\n"),
			);
		}

		const full = await check_full(workspace, session, diagnostics);
		if ("skipped" in full) {
			// A target that names no node leaves no full devicetree to check (VALIDATE-041): the warnings say why.
			const all = [...diagnostics, ...reg, full.skipped];
			return answer(
				() => parse_dt_validate_output(all),
				() => format_validation_report(all, display).join("\n"),
			);
		}
		if (!("kept" in full)) { return full; }
		const all = [...diagnostics, ...full.kept, ...reg];
		return answer(
			() => ({ ...parse_dt_validate_output(all), base_findings: full.base }),
			() => [
				...format_validation_report(all, display),
				...(full.base > 0 ? [`${full.base} more finding(s) in the base devicetree`] : []),
			].join("\n"),
		);
	},
});

/**
 * Compile `input` with dtc into `dtb` and run dt-validate on it into
 * `error_json`: its diagnostics, each about the node it concerns (VALIDATE-006,
 * `has_node` saying which nodes the tree has) and with the properties a binding
 * forbids named (VALIDATE-031), or the tool failure to answer with. With a
 * `state_directory`, dt-validate gets the part of validation.json the dtb's
 * compatibles need (VALIDATE-014), and the whole of it when it fails on that;
 * the subset goes to the long-lived dt-validate when the GUI runs this (worker.ts).
 */
async function check(
	workspace: Checked, input: string, dtb: string, error_json: string, has_node: (at: string) => boolean, state_directory?: string,
): Promise<DtValidateDiagnostic[] | Outcome<ValidationResponse>> {
	const { dtc } = workspace.tools;
	let dtc_error: string | undefined;
	try {
		execSync(`"${dtc}" -I dts -O dtb -o "${dtb}" "${input}"`, { stdio: "pipe" });
	} catch (error: any) {
		dtc_error = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
	}
	if (dtc_error !== undefined) { return tool_failure(dtc_error, `dtc error:\n${dtc_error}`); }

	// The properties of the node a finding is on, in the merged tree (merged only when a finding asks).
	const properties_of = (node: string): ReadonlySet<string> | undefined => {
		const found = workspace.overlay.tree.merged_tree()?.node_at(node);
		return found === undefined ? undefined : new Set(found.properties.map(property => property.name));
	};
	const named = (diagnostics: DtValidateDiagnostic[] | Outcome<ValidationResponse>, file: string): DtValidateDiagnostic[] | Outcome<ValidationResponse> =>
		Array.isArray(diagnostics) ? name_forbidden(diagnostics.map(d => about_node(d, has_node)), () => read_schemas(file), properties_of) : diagnostics;

	const schema = workspace.bindings.validation_schema;
	const subset = state_directory === undefined ? undefined : validation_subset(state_directory, schema, dtb);
	if (subset !== undefined) {
		const diagnostics = await run_dt_validate(workspace, subset, dtb, error_json, state_directory);
		if (Array.isArray(diagnostics)) { return named(diagnostics, subset); }
		fs.rmSync(subset, { force: true });
	}
	return named(await run_dt_validate(workspace, schema, dtb, error_json), schema);
}

/** The schemas of a validation.json (or a subset of it), by `$id`; undefined when it can't be read. */
function read_schemas(file: string): Record<string, unknown> | undefined {
	try {
		const schemas: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		return typeof schemas === "object" && schemas !== null && !Array.isArray(schemas) ? schemas as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

/** What dt-validate says of a value a `false` schema rejects. */
const FALSE_SCHEMA = /^False schema does not allow /;

/** How a property the binding forbids is worded (VALIDATE-031). */
export const FORBIDDEN_MESSAGE = "the binding doesn't allow it on this node";

/**
 * dt-validate names no property when the binding forbids one (`spi-cpol: false` under an
 * `else`): `False schema does not allow True`, with no property path and a schema path ending
 * in the `properties` that hold the `false`. The property is the one the node has among those
 * set to `false` there; the n-th such finding of a node and schema path is the n-th of them, as
 * dt-validate checks them in the schema's order. The finding gets it as its property path and
 * is worded `FORBIDDEN_MESSAGE` (VALIDATE-031). `schemas` is read only when there is one.
 */
export function name_forbidden(
	diagnostics: DtValidateDiagnostic[],
	schemas: () => Record<string, unknown> | undefined,
	properties_of: (node: string) => ReadonlySet<string> | undefined,
): DtValidateDiagnostic[] {
	let loaded: Record<string, unknown> | undefined;
	let read = false;
	const seen = new Map<string, number>();
	return diagnostics.map(d => {
		const { node, schema, schema_path, message } = d;
		if (message === undefined || !FALSE_SCHEMA.test(message) || (d.property_path ?? []).length > 0) { return d; }
		if (node === undefined || schema === undefined || !Array.isArray(schema_path) || schema_path.at(-1) !== "properties") { return d; }
		if (!read) { loaded = schemas(); read = true; }
		let at: unknown = loaded?.[schema];
		for (const step of schema_path) {
			at = typeof at === "object" && at !== null ? (at as Record<string, unknown>)[String(step)] : undefined;
		}
		if (typeof at !== "object" || at === null) { return d; }
		const present = properties_of(node);
		const forbidden = Object.entries(at).filter(([name, value]) => value === false && (present === undefined || present.has(name))).map(([name]) => name);
		const key = [node, schema, schema_path.join("/")].join("\n");
		const index = seen.get(key) ?? 0;
		seen.set(key, index + 1);
		const name = present === undefined ? (forbidden.length === 1 ? forbidden[0] : undefined) : forbidden[index];
		if (name === undefined) { return d; }
		return {
			...d,
			property_path: [name],
			message: FORBIDDEN_MESSAGE,
			...(d.formatted === undefined ? {} : { formatted: d.formatted.replace(message, () => `${name}: ${FORBIDDEN_MESSAGE}`) }),
		};
	});
}

/**
 * dt-validate on `dtb` with `schema`, into `error_json`: its diagnostics, or the tool failure to answer with. With a
 * `worker_directory` (the state directory), the GUI's runs ask the long-lived dt-validate first.
 */
async function run_dt_validate(
	workspace: Checked, schema: string, dtb: string, error_json: string, worker_directory?: string,
): Promise<DtValidateDiagnostic[] | Outcome<ValidationResponse>> {
	// Delete stale error.json so a dt-validate crash isn't hidden by an old file.
	if (fs.existsSync(error_json)) { fs.unlinkSync(error_json); }

	const worker = workspace.tools.dt_validate_worker;
	// A long-lived process (the GUI's runs, in its process) owns it itself; a child run of the GUI's server, by the variable.
	const owner = workspace.context.long_lived === true ? process.pid : worker_owner();
	if (worker !== undefined && owner !== undefined && worker_directory !== undefined
		&& await validate_with_worker(worker, owner, worker_directory, {
			schema, dtb, json_output: error_json, ...(workspace.context.cwd === undefined ? {} : { cwd: workspace.context.cwd }),
		})) {
		const diagnostics = read_dt_validate_diagnostics(error_json);
		if (!("error" in diagnostics)) { return diagnostics; }
	}

	// dt-validate exits non-zero when there are validation errors — that is not a tool failure.
	// We always read error.json; only fall back to stderr if the file wasn't written.
	let tool_error: string | undefined;
	try {
		execSync(`"${workspace.tools.dt_validate}" -s "${schema}" "${dtb}" --json-output "${error_json}"`, { stdio: "pipe" });
	} catch (error: any) {
		const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
		if (!fs.existsSync(error_json)) {
			tool_error = stderr;
		}
	}
	if (tool_error !== undefined) { return tool_failure(tool_error, `dt-validate error:\n${tool_error}`); }

	const diagnostics = read_dt_validate_diagnostics(error_json);
	return "error" in diagnostics ? tool_failure(diagnostics.error, diagnostics.error) : diagnostics;
}

/**
 * `--full`: dt-validate on the base with the overlay applied. Its findings, each
 * about the node it concerns (VALIDATE-006), on what the overlay touches
 * (`touched_by`) are kept unless the overlay's own run already has them (same
 * node, property and message); the others are counted as the base's. A repeat
 * counts once (VALIDATE-008). A fragment whose target names no node leaves no
 * full devicetree: the run is `skipped`, with the warning that says so (VALIDATE-041).
 */
async function check_full(
	workspace: Checked, session: Session, checked: DtValidateDiagnostic[],
): Promise<{ kept: DtValidateDiagnostic[]; base: number } | { skipped: DtValidateDiagnostic } | Outcome<ValidationResponse>> {
	const directory = session.state_dir;
	const preprocessed = path.join(directory, "full.preprocessed.dts");
	const problem = write_full_devicetree(workspace, path.join(directory, "full.dts"), preprocessed, FULL_EPILOGUE);
	if (problem?.type === "unresolved") {
		return { skipped: { level: "warning", message: `full devicetree not checked: ${problem.message}`, error_type: "unresolved" } };
	}
	if (problem !== undefined) {
		const message = `full devicetree not written: ${problem.message}`;
		return refuse(message, { type: problem.type });
	}
	const overlay = workspace.overlay.tree;
	let merged: DeviceTree | undefined;
	const has_node = (at: string): boolean => (merged ??= overlay.merged_tree())?.node_at(at) !== undefined;
	const diagnostics = await check(workspace, preprocessed, path.join(directory, "full.dtb"), path.join(directory, "full-error.json"), has_node);
	if (!Array.isArray(diagnostics)) { return diagnostics; }

	const touched = touched_by(overlay);
	const seen = new Set(checked.map(d => finding_key(d)));
	const kept: DtValidateDiagnostic[] = [];
	let base = 0;
	for (const d of unique_findings(diagnostics)) {
		if (d.node === undefined || d.node === "" || !is_touched(touched, d.node)) { base++; continue; }
		if (!seen.has(finding_key(d))) { kept.push(d); }
	}
	return { kept, base };
}

/**
 * The diagnostics without a repeat of an earlier one: the same node, property path and message
 * (VALIDATE-008). dt-validate reports some twice, from two schemas: the `reg` of a node under the
 * root from `reg.yaml` and from `root-node.yaml`.
 */
export function unique_findings(diagnostics: DtValidateDiagnostic[]): DtValidateDiagnostic[] {
	const seen = new Set<string>();
	return diagnostics.filter(d => {
		const key = finding_key(d);
		if (seen.has(key)) { return false; }
		seen.add(key);
		return true;
	});
}

function finding_key(d: DtValidateDiagnostic): string {
	return [d.node ?? "", (d.property_path ?? []).map(String).join("/"), d.message ?? ""].join("\n");
}

/** `/a/b` and `c` as `/a/b/c`; `/` and `c` as `/c`. */
const child_at = (parent: string, name: string): string => parent === "/" ? `/${name}` : `${parent}/${name}`;
/** The path above `at` (`/` for a child of the root). */
const parent_at = (at: string): string => at.slice(0, Math.max(at.lastIndexOf("/"), 1));

/**
 * The node a diagnostic is about (VALIDATE-006): its node, taken down the leading
 * segments of its property path that name a child there (`has_node`). dt-validate
 * reports what a device's binding, or a bus's, says of a channel or a device under
 * it on the node checked, with the child in the property path.
 */
export function about_node(d: DtValidateDiagnostic, has_node: (at: string) => boolean): DtValidateDiagnostic {
	if (d.node === undefined || d.node === "" || !Array.isArray(d.property_path)) { return d; }
	let node = d.node;
	let taken = 0;
	for (const segment of d.property_path) {
		if (typeof segment !== "string" || segment === "" || segment.includes("/")) { break; }
		const below = child_at(node, segment);
		if (!has_node(below)) { break; }
		node = below;
		taken++;
	}
	return taken === 0 ? d : { ...d, node, property_path: d.property_path.slice(taken) };
}

/** A node of the validation tree as it is built: its labels, its properties (a later one of a name in place of the earlier) and children. */
interface TreeNode {
	readonly name: string;
	readonly labels: string[];
	/** A property as the overlay or the base has it, or one the CLI writes (`#size-cells = <0>;`). */
	readonly properties: Map<string, DTProperty | string>;
	readonly children: Map<string, TreeNode>;
}

/** The validation tree (VALIDATE-001): the source dtc compiles, and what dt-validate's findings are read against. */
export interface ValidationTree {
	/** `temp.dts`. */
	readonly source: string;
	/** The validation-tree paths of its nodes. */
	readonly nodes: ReadonlySet<string>;
	/** Those of its stub nodes, whose findings are the CLI's stand-ins' (VALIDATE-007). */
	readonly stubs: ReadonlySet<string>;
}

/** The body of a fragment: what it writes where it goes. */
const body_of = (fragment: DTNode): DTNode | undefined => fragment.children.find(child => child.name === "__overlay__");

/**
 * Build the stand-in tree dt-validate checks (VALIDATE-001 to VALIDATE-005): the
 * nodes the overlay writes at their place in the base, each fragment's at its
 * target as build resolves it, several fragments' at one place merged as dtc
 * applies them. The base nodes on the way to them (the root and the targets
 * included) are there by name with their `#address-cells` / `#size-cells`, so a
 * bus's schema (`spi-controller.yaml`, by node name) checks its devices too. Every
 * base node the overlay references by label is there at its own path, with its
 * labels, `#*-cells` and `*-controller` properties, so dt-validate can decode
 * specifiers such as `<&gpio 26 1>`. A fragment whose target resolves to no node
 * keeps its nodes under `/node<N>`.
 */
/**
 * The path of the node a fragment's target resolves to (VALIDATE-001), as build resolves it
 * (BUILD-011), when the base with the overlay applied (`merged`) has that node; undefined
 * when it has none, a `target-path` that names no node or isn't absolute (`spi1/spidev@0`,
 * from an alias) included.
 */
function target_node_path(overlay: DeviceTreeOverlay, merged: DeviceTree | undefined, fragment: DTNode): string | undefined {
	const at = overlay.get_fragment_root_path(fragment);
	if (at === undefined || !at.startsWith("/")) { return undefined; }
	return merged === undefined || merged.node_at(at) !== undefined ? at : undefined;
}

export function build_validation_tree(overlay: DeviceTreeOverlay): ValidationTree {
	const base = overlay.get_base_dts();
	const fragments = overlay.get_fragments();
	// Where each fragment goes: the node its target resolves to, or its own /node<N> when that is
	// none, a target-path that names no node included (VALIDATE-001).
	const merged = overlay.merged_tree();
	const targets = fragments.map(fragment => target_node_path(overlay, merged, fragment));
	const places = targets.map((at, index) => at ?? `/node${index}`);
	const fallbacks = new Set(targets.flatMap((at, index) => at === undefined ? [`/node${index}`] : []));
	// The order the bodies merge in (VALIDATE-003): the applied fragments in BUILD-016's order, then
	// the others (unplaced, or only __dormant__) in file order.
	const applied = overlay.applied_fragments().applied.map(entry => entry.index);
	const placed = new Set(applied);
	const order = [...applied, ...[...fragments.keys()].filter(index => !placed.has(index))];

	// The paths a body has (below its target), and the labels the overlay defines, which need no stub.
	const had = new Set<string>();
	const defined_labels = new Set<string>();
	const collect = (node: DTNode, at: string): void => {
		for (const label of node.labels) { defined_labels.add(label); }
		for (const child of node.children) {
			const below = child_at(at, get_full_node_name(child));
			had.add(below);
			collect(child, below);
		}
	};
	for (const [index, fragment] of fragments.entries()) {
		const body = body_of(fragment);
		if (body !== undefined) { collect(body, places[index] ?? "/"); }
	}

	const new_node = (name: string): TreeNode => ({ name, labels: [], properties: new Map(), children: new Map() });
	const set_absent = (node: TreeNode, name: string, value: DTProperty | string): void => {
		if (!node.properties.has(name)) { node.properties.set(name, value); }
	};
	const root = new_node("");
	root.properties.set("compatible", `compatible = "goo";`);
	root.properties.set("model", `model = "goo";`);
	const nodes = new Map<string, TreeNode>([["/", root]]);

	/** The base's cells of the node at `at` on a stub of it (VALIDATE-002), 1 and 0 when the base has none. */
	const stub_cells = (node: TreeNode, at: string): void => {
		if (had.has(at) || fallbacks.has(at)) { return; }
		const base_node = base?.node_at(at);
		const address = base_node === undefined ? undefined : get_cell_value(base_node, "#address-cells");
		const size = base_node === undefined ? undefined : get_cell_value(base_node, "#size-cells");
		set_absent(node, "#address-cells", `#address-cells = <${address ?? 1n}>;`);
		set_absent(node, "#size-cells", `#size-cells = <${size ?? 0n}>;`);
	};
	/** The node at `at`, made with what is on the way to it; `cells`: a node on the way to a target, which gets its cells. */
	const ensure = (at: string, cells: boolean): TreeNode => {
		let node = nodes.get(at);
		if (node === undefined) {
			const parent = ensure(parent_at(at), true);
			const name = at.slice(at.lastIndexOf("/") + 1);
			node = parent.children.get(name) ?? new_node(name);
			parent.children.set(name, node);
			nodes.set(at, node);
			if (fallbacks.has(at)) {
				node.properties.set("#address-cells", "#address-cells = <1>;");
				node.properties.set("#size-cells", "#size-cells = <0>;");
			}
		}
		if (cells) { stub_cells(node, at); }
		return node;
	};
	const add_labels = (node: TreeNode, labels: readonly string[]): void => {
		for (const label of labels) { if (!node.labels.includes(label)) { node.labels.push(label); } }
	};
	/** A body's node merged into the tree's, as dtc applies an overlay (VALIDATE-003). */
	const merge = (node: TreeNode, from: DTNode, at: string): void => {
		add_labels(node, from.labels);
		for (const property of from.properties) { node.properties.set(property.name, property); }
		for (const child of from.children) {
			const below = child_at(at, get_full_node_name(child));
			merge(ensure(below, false), child, below);
		}
	};

	// The fragments at one place, with interrupts somewhere and no interrupt-parent label, get a stand-in controller (VALIDATE-005).
	const interrupts = new Map<string, { first: number; has_interrupts: boolean; has_parent: boolean }>();
	for (const [index, fragment] of fragments.entries()) {
		const body = body_of(fragment);
		if (body === undefined) { continue; }
		const place = places[index] ?? "/";
		const info = check_interrupt_info(body);
		const seen = interrupts.get(place) ?? { first: index, has_interrupts: false, has_parent: false };
		interrupts.set(place, {
			first: seen.first,
			has_interrupts: seen.has_interrupts || info.has_interrupts,
			has_parent: seen.has_parent || info.interrupt_parent_label !== undefined,
		});
	}

	const stubbed = new Set<string>();
	for (const index of order) {
		const fragment = fragments[index];
		if (fragment === undefined) { continue; }
		const place = places[index] ?? "/";
		const target = ensure(place, true);
		const body = body_of(fragment);
		if (body === undefined) { continue; }

		const intc = interrupts.get(place);
		if (intc !== undefined && intc.first === index && intc.has_interrupts && !intc.has_parent) {
			const label = `fake_intc_${index}`;
			set_absent(target, "interrupt-parent", `interrupt-parent = <&${label}>;`);
			const controller = ensure(child_at("/", label), false);
			add_labels(controller, [label]);
			controller.properties.set("#interrupt-cells", "#interrupt-cells = <1>;");
			controller.properties.set("interrupt-controller", "interrupt-controller;");
		}

		for (const child of body.children) {
			const below = child_at(place, get_full_node_name(child));
			merge(ensure(below, false), child, below);
		}

		// The base nodes it references, at their own path (VALIDATE-004).
		for (const label of collect_referenced_labels(body)) {
			if (defined_labels.has(label) || base === undefined) { continue; }
			const provider = base.locate(label);
			if (provider === undefined || stubbed.has(provider.path)) { continue; }
			stubbed.add(provider.path);
			const node = ensure(provider.path, false);
			add_labels(node, provider.node.labels.filter(name => !defined_labels.has(name)));
			for (const property of provider.node.properties) {
				if (/^#.+-cells$/.test(property.name) || property.name.endsWith("-controller")) { set_absent(node, property.name, property); }
			}
		}
	}

	const stubs = new Set([...nodes.keys()].filter(at => !had.has(at) && !fallbacks.has(at)));
	return {
		source: ["/dts-v1/;", "/plugin/;", "", ...print_tree_node(root, ""), ""].join("\n"),
		nodes: new Set(nodes.keys()),
		stubs,
	};
}

/** A node of the validation tree as devicetree source, one tab in per level. */
function print_tree_node(node: TreeNode, indent: string): string[] {
	const labels = node.labels.length > 0 ? `${node.labels.join(": ")}: ` : "";
	const inner = `${indent}\t`;
	return [
		`${indent}${labels}${node.name === "" ? "/" : node.name} {`,
		...[...node.properties.values()].map(property => typeof property === "string" ? `${inner}${property}` : print_dtprop(property, inner)),
		...[...node.children.values()].flatMap(child => print_tree_node(child, inner)),
		`${indent}};`,
	];
}

/** Labels referenced as phandles (`<&label …>`) by `node` or any descendant, in first-use order. */
function collect_referenced_labels(node: DTNode): string[] {
	const labels = new Set<string>();
	const scan = (n: DTNode): void => {
		for (const property of n.properties) {
			if (is_dt_flag(property.value)) { continue; }
			for (const cell of property.value) {
				if (cell.kind !== "array") { continue; }
				for (const element of cell.elements) {
					if (element.kind === "label") { labels.add((element as DTLabel).name); }
				}
			}
		}
		for (const child of n.children) { scan(child); }
	};
	scan(node);
	return [...labels];
}

function get_cell_value(node: DTNode, name: string): bigint | undefined {
	const property = node.properties.find(p => p.name === name);
	if (property === undefined || is_dt_flag(property.value)) { return undefined; }
	const value = cell_extract_first_value(property);
	return typeof value === "bigint" ? value : undefined;
}

interface InterruptInfo {
	has_interrupts: boolean;
	interrupt_parent_label: string | undefined;
}

function check_interrupt_info(node: DTNode): InterruptInfo {
	let has_interrupts = false;
	let interrupt_parent_label: string | undefined;

	function scan(n: DTNode): void {
		for (const property of n.properties) {
			if (property.name === "interrupts") { has_interrupts = true; }
			if (property.name === "interrupt-parent" && !is_dt_flag(property.value)) {
				const first = property.value[0];
				if (first?.kind === "array") {
					for (const element of first.elements) {
						if (element.kind === "label") {
							interrupt_parent_label = (element as DTLabel).name;
						}
					}
				}
			}
		}
		for (const child of n.children) { scan(child); }
	}

	scan(node);
	return { has_interrupts, interrupt_parent_label };
}

function print_dtprop(property: DTProperty, indent: string): string {
	if (is_dt_flag(property.value)) {
		return `${indent}${property.name};`;
	}
	return `${indent}${print_property(property, indent, 0).trim()}`;
}

interface DtValidateDiagnostic {
	type?: string;
	level?: string;
	node?: string;
	property_path?: unknown[];
	/** The `$id` of the schema that failed, and where in it (`["allOf", 0, "else", "properties"]`). */
	schema?: string;
	schema_path?: unknown[];
	formatted?: string;
	message?: string;
	note?: string;
	context?: unknown[];
	/** The finding's type when the CLI made it (an address warning); else `finding_type` reads it off the message. */
	error_type?: ErrorType;
}

export function read_dt_validate_diagnostics(error_json: string): DtValidateDiagnostic[] | { error: string } {
	let content: string;
	try {
		content = fs.readFileSync(error_json, "utf8");
	} catch (error: any) {
		return { error: `dt-validate output unreadable: ${error.message ?? String(error)}` };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch {
		return { error: `dt-validate output unreadable: not valid JSON` };
	}
	if (!Array.isArray(raw)) { return { error: `dt-validate output unreadable: not an array` }; }
	return raw as DtValidateDiagnostic[];
}

/** What a fragment's target names: the first label of `target`, else `target-path`. */
function target_text(fragment: DTNode): string | undefined {
	const target = fragment.properties.find(p => p.name === "target");
	if (target !== undefined && !is_dt_flag(target.value)) {
		const first = target.value[0];
		const label = first?.kind === "array" ? first.elements.find(element => element.kind === "label") : undefined;
		if (label !== undefined) { return (label as DTLabel).name.replace(/^&/, ""); }
	}
	const target_path = fragment.properties.find(p => p.name === "target-path");
	if (target_path !== undefined && !is_dt_flag(target_path.value)) {
		const first = target_path.value[0];
		if (first?.kind === "string") { return first.value; }
	}
	return undefined;
}

/**
 * How human output names a validation-tree path (VALIDATE-025): label-first
 * (`spi0/adc@0`), or for a fragment whose target resolves to no node, `/node<N>`
 * as what its target names.
 */
export function validation_display(overlay: DeviceTreeOverlay): (node: string) => string {
	const labels = overlay.all_labels();
	const fragments = overlay.get_fragments();
	let merged: DeviceTree | undefined;
	return node => {
		const match = /^\/node(\d+)(.*)$/.exec(node);
		const fragment = match === null ? undefined : fragments[Number(match[1])];
		if (match === null || fragment === undefined) { return display_path(node, labels); }
		merged ??= overlay.merged_tree();
		if (target_node_path(overlay, merged, fragment) !== undefined) { return display_path(node, labels); }
		const target = target_text(fragment);
		return target === undefined ? node : `${target}${match[2] ?? ""}`;
	};
}

export function format_validation_report(diagnostics: DtValidateDiagnostic[], display: (node: string) => string): string[] {
	const errors: DtValidateDiagnostic[] = [];
	const warnings: DtValidateDiagnostic[] = [];
	const nodeless: DtValidateDiagnostic[] = [];

	for (const d of diagnostics) {
		if (d.node === undefined || d.node === "") {
			nodeless.push(d);
		} else if (d.level === "warning") {
			warnings.push(d);
		} else {
			errors.push(d);
		}
	}

	const lines: string[] = [];

	for (const d of nodeless) {
		const level = d.level === "warning" ? "warning" : "error";
		lines.push(`${level}: ${d.message ?? "Unknown error"}`);
		if (d.note !== undefined) { lines.push(`  note: ${d.note}`); }
	}

	const grouped = new Map<string, DtValidateDiagnostic[]>();
	for (const d of [...errors, ...warnings]) {
		const key = display(d.node!);
		const group = grouped.get(key);
		if (group === undefined) { grouped.set(key, [d]); } else { group.push(d); }
	}

	for (const [node, group] of grouped) {
		lines.push(`${node}:`);
		for (const d of group) {
			const level = d.level === "warning" ? "warning" : "error";
			const property_path = Array.isArray(d.property_path) && d.property_path.length > 0
				? d.property_path.map(String).join("/")
				: "(node)";
			lines.push(`  ${level}: ${property_path}: ${d.message ?? "Unknown error"}`);
			if (d.note !== undefined) { lines.push(`    note: ${d.note}`); }
			if (d.context !== undefined) {
				for (const line of d.context) {
					const text = typeof line === "string" ? line : JSON.stringify(line);
					lines.push(`    context: ${text}`);
				}
			}
		}
	}

	const error_count = errors.length + nodeless.filter(d => d.level !== "warning").length;
	const warning_count = warnings.length + nodeless.filter(d => d.level === "warning").length;

	if (error_count > 0) {
		lines.push(`${error_count} error(s), ${warning_count} warning(s)`);
	} else if (warning_count > 0) {
		lines.push(`No errors! (${warning_count} warning(s))`);
	} else {
		lines.push("No errors!");
	}

	return lines;
}

/** Reg clashes as warnings on `reg` of the node, at its absolute path (VALIDATE-112). */
export function reg_diagnostics(warnings: RegWarning[]): DtValidateDiagnostic[] {
	return warnings.map(warning => ({
		level: "warning",
		node: warning.path,
		property_path: ["reg"],
		message: warning.message,
		error_type: "resource-conflict" as const,
		...(warning.hint === undefined
			? {}
			: { note: warning.hint, formatted: `${warning.message}; ${warning.hint}` }),
	}));
}

/** Devices on a parent that is off (VALIDATE-130), as warnings on the node, at its absolute path. */
export function parent_diagnostics(warnings: DisabledParentWarning[]): DtValidateDiagnostic[] {
	return warnings.map(warning => ({
		level: "warning",
		node: warning.path,
		property_path: [],
		message: warning.message,
		error_type: "unresolved" as const,
		note: warning.hint,
		formatted: `${warning.message}; ${warning.hint}`,
	}));
}

/** A finding of the CLI's as a warning of error type `unresolved`, its hint as the note. */
function unresolved_warning(finding: Finding, at: { node?: string; property_path?: unknown[] }): DtValidateDiagnostic {
	return {
		level: "warning",
		...at,
		message: finding.message,
		error_type: "unresolved",
		...(finding.hint === undefined ? {} : { note: finding.hint, formatted: `${finding.message}; ${finding.hint}` }),
	};
}

/** What `import` lists of a fragment (IMPORT-041): its node name, the property that names its target, and that target. */
function target_entry(fragment: DTNode): UnresolvedTargetEntry {
	const by_label = fragment.properties.some(p => p.name === "target");
	const property = fragment.properties.find(p => p.name === (by_label ? "target" : "target-path"));
	const first = property === undefined || is_dt_flag(property.value) ? undefined : property.value[0];
	const element = first?.kind === "array" ? first.elements[0] : undefined;
	let target = "";
	if (first?.kind === "string") { target = first.value; }
	if (element?.kind === "label") { target = (element as DTLabel).name.replace(/^&/, ""); }
	if (element?.kind === "path") { target = (element as DTPath).path; }
	return { fragment: get_full_node_name(fragment), property: by_label ? "target" : "target-path", target };
}

/**
 * The fragments whose target resolves to no node (VALIDATE-141): those whose nodes go under `/node<N>` (VALIDATE-001),
 * which `build` and `--full` refuse (BUILD-013). Warnings without a node, in file order, worded as `import` lists them.
 */
export function target_diagnostics(overlay: DeviceTreeOverlay): DtValidateDiagnostic[] {
	const merged = overlay.merged_tree();
	return overlay.get_fragments()
		.filter(fragment => target_node_path(overlay, merged, fragment) === undefined)
		.map(fragment => unresolved_warning(target_finding(target_entry(fragment)), {}));
}

/**
 * The references of the `__overlay__` bodies that name no node of the base or the overlay (VALIDATE-140), each
 * node, property and reference once, as warnings on the property at its validation-tree path, fragment by fragment
 * in tree order. dtc takes them in an overlay as fixups, which the board then can't resolve.
 */
export function reference_diagnostics(overlay: DeviceTreeOverlay): DtValidateDiagnostic[] {
	const merged = overlay.merged_tree();
	const resolve = reference_resolver(overlay);
	const found = overlay.get_fragments().flatMap((fragment, index) => {
		const body = body_of(fragment);
		return body === undefined ? [] : unresolved_in(body, target_node_path(overlay, merged, fragment) ?? `/node${index}`, resolve);
	});
	return unique_references(found).map(({ path: node, property, reference }) =>
		unresolved_warning(reference_finding(reference), { node, property_path: [property] }));
}

/**
 * The negative numbers the overlay writes in a cell its binding holds unsigned (VALIDATE-120), as warnings on the
 * property, at its absolute path, fragment by fragment in tree order. Only a property that holds a negative has its
 * node's binding looked up.
 */
export async function unsigned_diagnostics(overlay: DeviceTreeOverlay, base_dt: DeviceTree, bindings: Bindings): Promise<DtValidateDiagnostic[]> {
	const found: DtValidateDiagnostic[] = [];
	const merged = overlay.merged_tree();
	const visit = async (node: DTNode, root: string, rest: string): Promise<void> => {
		const negative = node.properties.filter(property => has_negative(property));
		if (negative.length > 0) {
			const absolute = root === "/" ? (rest === "" ? "/" : rest) : `${root}${rest}`;
			const { binding_node, binding_parent, parent_name } = resolve_write_target(absolute, overlay, base_dt);
			for (const property of negative) {
				const { definition } = await resolve_property_definition(binding_node, binding_parent, parent_name, merged ?? base_dt, bindings, property.name, () => {});
				const message = definition === undefined ? undefined : unsigned_finding(property.name, definition.value, property);
				if (message !== undefined) {
					found.push({ level: "warning", node: absolute, property_path: [property.name], message, error_type: "out-of-range" });
				}
			}
		}
		for (const child of node.children) { await visit(child, root, `${rest}/${get_full_node_name(child)}`); }
	};
	// A fragment whose target resolves to no node (its /node<N>) has no parent to look a binding up under.
	for (const fragment of overlay.get_fragments()) {
		const root = target_node_path(overlay, merged, fragment);
		const body = body_of(fragment);
		if (root !== undefined && body !== undefined) { await visit(body, root, ""); }
	}
	return found;
}

function map_diagnostic(d: DtValidateDiagnostic): ValidationError {
	const node_segs = typeof d.node === "string" ? d.node.split("/").filter(s => s.length > 0) : [];
	const property_segs = Array.isArray(d.property_path) ? d.property_path.map(String) : [];
	return {
		kind: "generic",
		path: [...node_segs, ...property_segs],
		message: d.formatted ?? d.message ?? "Unknown error",
		error_type: d.error_type ?? finding_type(d.message ?? ""),
	};
}

/**
 * A dt-validate finding's type (GEN-17): a required property, or one another needs, that is
 * missing is `missing-required`; anything else the binding doesn't allow (a type, a range, a
 * count, a property it doesn't define) is `out-of-range`.
 */
export function finding_type(message: string): ErrorType {
	return / is a required property$| is a dependency of /.test(message) ? "missing-required" : "out-of-range";
}

function parse_dt_validate_output(diagnostics: DtValidateDiagnostic[]): ValidationResponse {
	const errors: ValidationError[] = [];
	const warnings: ValidationError[] = [];

	for (const entry of diagnostics) {
		const mapped = map_diagnostic(entry);
		if (entry.level === "warning") {
			warnings.push(mapped);
		} else {
			errors.push(mapped);
		}
	}

	return { ...validation_header(errors.length, warnings.length), errors, warnings };
}

if (import.meta.vitest) {
	const { test, expect, describe } = import.meta.vitest;

	const base = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        gpio: gpio@7e200000 {
            compatible = "brcm,bcm2711-gpio";
            gpio-controller;
            #gpio-cells = <2>;
            interrupt-controller;
            #interrupt-cells = <2>;
        };
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`);
	if (typeof base === "string") { throw new TypeError(base); }

	const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;
/plugin/;
&spi0 {
    expander: dac@0 {
        reg = <0>;
        gpio-controller;
        #gpio-cells = <2>;
        interrupt-parent = <&gpio>;
        interrupts = <19 2>;
        reset-gpios = <&gpio 26 1>;
    };
};
&{/} {
    ports {
        in-gpios = <&expander 4 0>;
    };
};`, base);
	if (typeof overlay === "string") { throw new TypeError(overlay); }

	/** `source` as an overlay of `base`, or of the module's base. */
	const overlay_of = (source: string, on: DeviceTree = base): DeviceTreeOverlay => {
		const parsed = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n${source}`, on);
		if (typeof parsed === "string") { throw new TypeError(parsed); }
		return parsed;
	};

	test("build_validation_tree — the overlay's nodes at their place, the base's on the way and the providers it references reduced to stubs", () => {
		const tree = build_validation_tree(overlay);
		expect(tree.source).toBe(`/dts-v1/;
/plugin/;

/ {
\tcompatible = "goo";
\tmodel = "goo";
\t#address-cells = <1>;
\t#size-cells = <0>;
\tsoc {
\t\t#address-cells = <1>;
\t\t#size-cells = <0>;
\t\tspi@7e204000 {
\t\t\t#address-cells = <1>;
\t\t\t#size-cells = <0>;
\t\t\texpander: dac@0 {
\t\t\t\treg = <0>;
\t\t\t\tgpio-controller;
\t\t\t\t#gpio-cells = <2>;
\t\t\t\tinterrupt-parent = <&gpio>;
\t\t\t\tinterrupts = <19 2>;
\t\t\t\treset-gpios = <&gpio 26 1>;
\t\t\t};
\t\t};
\t\tgpio: gpio@7e200000 {
\t\t\tgpio-controller;
\t\t\t#gpio-cells = <2>;
\t\t\tinterrupt-controller;
\t\t\t#interrupt-cells = <2>;
\t\t};
\t};
\tports {
\t\tin-gpios = <&expander 4 0>;
\t};
};
`);
		expect([...tree.stubs]).toEqual(["/", "/soc", "/soc/spi@7e204000", "/soc/gpio@7e200000"]);
		expect([...tree.nodes]).toEqual(["/", "/soc", "/soc/spi@7e204000", "/soc/spi@7e204000/dac@0", "/soc/gpio@7e200000", "/ports"]);
	});

	test("build_validation_tree — bodies at one place are one node, a later property in place of the earlier; a target by a label the overlay defines", () => {
		const tree = build_validation_tree(overlay_of(`&spi0 {
    adc@0 { reg = <0>; spi-max-frequency = <1>; channel@0 { reg = <0>; }; };
};
&spi0 {
    status = "okay";
    adc@0 { spi-max-frequency = <2>; adc: channel@1 { reg = <1>; }; };
};
&adc {
    bipolar;
};`));
		const adc = tree.source.slice(tree.source.indexOf("adc@0 {"));
		expect(adc.match(/spi-max-frequency = <\d>;/g)).toEqual(["spi-max-frequency = <2>;"]);
		expect(adc.indexOf("reg = <0>;")).toBeLessThan(adc.indexOf("spi-max-frequency"));
		expect(adc).toContain("adc: channel@1 {\n\t\t\t\t\treg = <1>;\n\t\t\t\t\tbipolar;\n\t\t\t\t};");
		// The properties set on a target aren't in the tree.
		expect(tree.source).not.toContain("status");
		expect(tree.stubs.has("/soc/spi@7e204000/adc@0/channel@1")).toBe(false);
	});

	test("build_validation_tree — a target the base doesn't have keeps its nodes under node<N>; a stand-in interrupt controller at the root", () => {
		const tree = build_validation_tree(overlay_of(`&nowhere {
    dev@1 { reg = <1>; };
};
&spi0 {
    adc@0 { reg = <0>; interrupts = <1>; };
};
&spi0 {
    adc@1 { reg = <1>; interrupts = <2>; };
};`));
		expect(tree.source).toContain("\tnode0 {\n\t\t#address-cells = <1>;\n\t\t#size-cells = <0>;\n\t\tdev@1 {");
		expect(tree.source).toContain("\t\tspi@7e204000 {\n\t\t\t#address-cells = <1>;\n\t\t\t#size-cells = <0>;\n\t\t\tinterrupt-parent = <&fake_intc_1>;\n");
		expect(tree.source).toContain("\tfake_intc_1: fake_intc_1 {\n\t\t#interrupt-cells = <1>;\n\t\tinterrupt-controller;\n\t};");
		expect(tree.source).not.toContain("fake_intc_2");
		expect(tree.nodes.has("/node0/dev@1")).toBe(true);
		expect(tree.stubs.has("/node0")).toBe(false);
		expect(tree.stubs.has("/fake_intc_1")).toBe(true);
	});

	test("build_validation_tree — a target-path that names no node, or isn't absolute, keeps its nodes under node<N>, and shows as written", () => {
		const fragments = overlay_of(`/ {
    fragment@0 { target-path = "/nowhere"; __overlay__ { dev@2 { reg = <2>; }; }; };
    fragment@1 { target-path = "/soc"; __overlay__ { dev@3 { reg = <3>; }; }; };
    fragment@2 { target-path = "spi0/dev@4"; __overlay__ { dev@5 { reg = <5>; }; }; };
};`);
		const tree = build_validation_tree(fragments);
		expect(tree.nodes.has("/node0/dev@2")).toBe(true);
		expect(tree.nodes.has("/nowhere")).toBe(false);
		expect(tree.nodes.has("/soc/dev@3")).toBe(true);
		expect(tree.nodes.has("/node2/dev@5")).toBe(true);
		expect(validation_display(fragments)("/node0/dev@2")).toBe("/nowhere/dev@2");
		expect(validation_display(fragments)("/node2/dev@5")).toBe("spi0/dev@4/dev@5");
	});

	test("build_validation_tree — a referenced base node the overlay also writes gets its labels and cells, the body's own values kept", () => {
		const tree = build_validation_tree(overlay_of(`&{/soc} {
    gpio@7e200000 { #gpio-cells = <3>; pins { brcm,pins = <4>; }; };
};
&spi0 {
    adc@0 { reg = <0>; reset-gpios = <&gpio 1 0>; };
};`));
		expect(tree.source).toContain(`\t\tgpio: gpio@7e200000 {
\t\t\t#gpio-cells = <3>;
\t\t\tgpio-controller;
\t\t\tinterrupt-controller;
\t\t\t#interrupt-cells = <2>;
\t\t\tpins {`);
		expect(tree.source.match(/gpio@7e200000 \{/g)).toHaveLength(1);
		expect(tree.stubs.has("/soc")).toBe(true);
		expect(tree.stubs.has("/soc/gpio@7e200000")).toBe(false);
	});

	test("build_validation_tree — a target the overlay only sets properties on is a stub with its cells", () => {
		const tree = build_validation_tree(overlay_of(`&gpio { #gpio-cells = <3>; pins { brcm,pins = <4>; }; };`));
		expect(tree.source).toContain("\t\tgpio@7e200000 {\n\t\t\t#address-cells = <1>;\n\t\t\t#size-cells = <0>;\n\t\t\tpins {");
		expect(tree.source).not.toContain("gpio-cells");
		expect(tree.stubs.has("/soc/gpio@7e200000")).toBe(true);
		expect(tree.stubs.has("/soc/gpio@7e200000/pins")).toBe(false);
	});

	test("build_validation_tree — a fragment on a node a later fragment adds is merged after it (BUILD-016)", () => {
		const tree = build_validation_tree(overlay_of(`/ {
    fragment@0 { target = <&ts>; __overlay__ { sub { r = <1>; }; }; };
    fragment@1 { target = <&spi0>; __overlay__ { ts: ts@0 { reg = <0>; sub { r = <2>; }; }; }; };
};`));
		expect(tree.nodes.has("/soc/spi@7e204000/ts@0/sub")).toBe(true);
		expect(tree.nodes.has("/node0")).toBe(false);
		expect(tree.source).toContain("sub {\n\t\t\t\t\tr = <1>;\n\t\t\t\t};");
		expect(tree.source).not.toContain("r = <2>;");
	});

	test.skipIf(!is_tool_available("dtc --version"))("build_validation_tree — dtc compiles the stand-in tree", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-validate-"));
		try {
			const input = path.join(directory, "t.dts");
			fs.writeFileSync(input, build_validation_tree(overlay).source);
			execSync(`dtc -I dts -O dtb -o "${path.join(directory, "t.dtb")}" "${input}"`, { stdio: "pipe" });
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test("unique_findings — a repeat of the same node, property path and message is left out", () => {
		const reg = { level: "error", node: "/mux@1", property_path: ["reg", 0], message: "[1] is too short", formatted: "a" };
		const other = { ...reg, property_path: ["reg", 1] };
		expect(unique_findings([reg, other, { ...reg, formatted: "b" }, { ...reg, message: "m" }])).toEqual([reg, other, { ...reg, message: "m" }]);
		expect(unique_findings([{ message: "x" }, { message: "x" }])).toEqual([{ message: "x" }]);
	});

	test("about_node — a diagnostic goes down its property path into the children the tree has", () => {
		const nodes = new Set(["/soc/spi@7e204000", "/soc/spi@7e204000/adc@5", "/soc/spi@7e204000/adc@5/channel@0"]);
		const has = (at: string): boolean => nodes.has(at);
		expect(about_node({ node: "/soc/spi@7e204000/adc@5", property_path: ["channel@0", "reg"], message: "m" }, has))
			.toEqual({ node: "/soc/spi@7e204000/adc@5/channel@0", property_path: ["reg"], message: "m" });
		expect(about_node({ node: "/soc/spi@7e204000", property_path: ["adc@5", "channel@0"], message: "m" }, has))
			.toMatchObject({ node: "/soc/spi@7e204000/adc@5/channel@0", property_path: [] });
		const kept: DtValidateDiagnostic = { node: "/soc/spi@7e204000/adc@5", property_path: ["reg", 0, 0], message: "m" };
		expect(about_node(kept, has)).toBe(kept);
		expect(about_node({ property_path: ["channel@0"] }, has)).toEqual({ property_path: ["channel@0"] });
	});

	test("validation_display — label-first, and node<N> as its fragment's target", () => {
		const display = validation_display(overlay_of(`&spi0 { adc@0 { reg = <0>; }; };\n&nowhere { dev@1 { reg = <1>; }; };`));
		expect(display("/soc/spi@7e204000/adc@0")).toBe("spi0/adc@0");
		expect(display("/soc/spi@7e204000")).toBe("spi0");
		expect(display("/soc")).toBe("/soc");
		expect(display("/node1/dev@1")).toBe("nowhere/dev@1");
		expect(display("/node7/x")).toBe("/node7/x");
	});

	/** A dt-validate that logs its schema and writes one diagnostic, or fails without output when `fail_on` is in the schema's path. */
	/** A dt-validate that logs the schema it gets, fails on one whose path has `fail_on`, and otherwise reports `found`. */
	const fake_dt_validate = (directory: string, fail_on: string, found: unknown[]): string => {
		const tool = path.join(directory, "dt-validate");
		fs.writeFileSync(tool, `#!/bin/sh\necho "$2" >> "${directory}/log"\ncase "$2" in *${fail_on}*) echo crashed >&2; exit 1 ;; esac\nprintf '%s' '${JSON.stringify(found)}' > "$5"\nexit 1\n`, { mode: 0o755 });
		return tool;
	};

	/**
	 * `check` on `on` (the module's overlay) in a fresh state directory with `fake_dt_validate` reporting `found`, and
	 * `schemas` in validation.json: its result, the schemas dt-validate got and the subsets left.
	 */
	const check_with = async (
		fail_on: string,
		{ on = overlay, found = [{ level: "error", node: "/soc/spi@7e204000/dac@0", message: "m" }], schemas = {} }: { on?: DeviceTreeOverlay; found?: unknown[]; schemas?: Record<string, unknown> } = {},
	): Promise<{ diagnostics: unknown; log: string[]; subsets: string[] }> => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-validate-"));
		try {
			const schema = path.join(directory, "validation.json");
			fs.writeFileSync(schema, JSON.stringify({ "generated-types": { $id: "generated-types", select: false }, ...schemas, version: "2026.9" }));
			const workspace = {
				tools: { dtc: "dtc", dt_validate: fake_dt_validate(directory, fail_on, found) },
				bindings: { validation_schema: schema },
				overlay: { tree: on },
				context: { state_dir: directory, assets_dir: directory, program: "analog-attach" },
			} as unknown as Checked;
			const input = path.join(directory, "temp.dts");
			const tree = build_validation_tree(on);
			fs.writeFileSync(input, tree.source);
			const diagnostics = await check(workspace, input, path.join(directory, "temp.dtb"), path.join(directory, "error.json"), at => tree.nodes.has(at), directory);
			const subsets = path.join(directory, "validation-cache", "validation-subsets");
			return {
				diagnostics,
				log: fs.readFileSync(path.join(directory, "log"), "utf8").trim().split("\n").map(file => path.relative(directory, file)),
				subsets: fs.existsSync(subsets) ? fs.readdirSync(subsets) : [],
			};
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	};

	describe.skipIf(!is_tool_available("dtc --version"))("check — dt-validate gets the subset of validation.json", () => {
		test("the subset, kept for the next run", async () => {
			const { diagnostics, log, subsets } = await check_with("nothing");
			expect(diagnostics).toEqual([{ level: "error", node: "/soc/spi@7e204000/dac@0", message: "m" }]);
			expect(log).toEqual([path.join("validation-cache", "validation-subsets", subsets[0] ?? "")]);
			expect(subsets).toHaveLength(1);
		});

		test("validation.json when dt-validate fails on the subset, which is deleted", async () => {
			const { diagnostics, log, subsets } = await check_with("validation-subsets");
			expect(diagnostics).toEqual([{ level: "error", node: "/soc/spi@7e204000/dac@0", message: "m" }]);
			expect(log).toHaveLength(2);
			expect(log[0]).toMatch(/^validation-cache\/validation-subsets\//);
			expect(log[1]).toBe("validation.json");
			expect(subsets).toEqual([]);
		});

		test("a property a binding forbids in a channel is named, on the channel (VALIDATE-006, VALIDATE-031)", async () => {
			const on = overlay_of(`&spi0 { adc@0 { reg = <0>; channel@0 { reg = <0>; bogus; }; }; };`);
			const schemas = { "http://s": { $id: "http://s", select: true, patternProperties: { "^channel@": { properties: { bogus: false } } } } };
			const found = [{
				level: "error", node: "/soc/spi@7e204000/adc@0", property_path: ["channel@0"], message: "False schema does not allow True",
				schema: "http://s", schema_path: ["patternProperties", "^channel@", "properties"],
			}];
			const { diagnostics } = await check_with("nothing", { on, found, schemas });
			expect(diagnostics).toMatchObject([{ node: "/soc/spi@7e204000/adc@0/channel@0", property_path: ["bogus"], message: FORBIDDEN_MESSAGE }]);
		});

		test("a failure on validation.json too is reported", async () => {
			const { diagnostics, log } = await check_with(".json");
			expect(log).toHaveLength(2);
			expect(diagnostics).toMatchObject({ kind: "refused", response: { error_type: "tool-failed", message: "crashed\n" } });
		});
	});

	test("read_dt_validate_diagnostics — non-JSON input", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-diag-"));
		const file = path.join(directory, "bad.json");
		try {
			fs.writeFileSync(file, "not json");
			const result = read_dt_validate_diagnostics(file);
			expect(result).toHaveProperty("error");
			expect((result as { error: string }).error).toContain("not valid JSON");
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test("read_dt_validate_diagnostics — empty array", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-diag-"));
		const file = path.join(directory, "empty.json");
		try {
			fs.writeFileSync(file, "[]");
			const result = read_dt_validate_diagnostics(file);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toHaveLength(0);
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test("read_dt_validate_diagnostics — missing file", () => {
		const result = read_dt_validate_diagnostics("/nonexistent/path.json");
		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("unreadable");
	});

	describe("name_forbidden", () => {
		const id = "http://devicetree.org/schemas/iio/dac/adi,ad5592r.yaml";
		const schemas = { [id]: { allOf: [{ else: { properties: { "spi-cpol": false, "spi-cpha": false, "#io-channel-cells": { const: 1 } } } }] } };
		const finding = (value: string): DtValidateDiagnostic => ({
			level: "error",
			node: "/soc/spi@7e204000/dac@0",
			property_path: [],
			schema,
			schema_path: ["allOf", 0, "else", "properties"],
			message: `False schema does not allow ${value}`,
			formatted: `.analog-attach/linux/temp.dtb: dac@0 (adi,ad5593r): False schema does not allow ${value}\n\tfrom schema $id: ${id}`,
		});
		const schema = id;

		test("the property the node has among those set to false, in the property path and the message", () => {
			const [named] = name_forbidden([finding("True")], () => schemas, () => new Set(["compatible", "reg", "spi-cpol"]));
			expect(named).toMatchObject({ property_path: ["spi-cpol"], message: FORBIDDEN_MESSAGE });
			expect(named?.formatted).toBe(`.analog-attach/linux/temp.dtb: dac@0 (adi,ad5593r): spi-cpol: ${FORBIDDEN_MESSAGE}\n\tfrom schema $id: ${id}`);
		});

		test("two forbidden properties set: the findings name them in the schema's order", () => {
			const named = name_forbidden([finding("True"), finding("True")], () => schemas, () => new Set(["spi-cpha", "spi-cpol"]));
			expect(named.map(d => d.property_path)).toEqual([["spi-cpol"], ["spi-cpha"]]);
		});

		test("a node not found: named only when one property is forbidden there", () => {
			const one = { [id]: { allOf: [{ else: { properties: { "spi-cpol": false } } }] } };
			expect(name_forbidden([finding("True")], () => one, () => {})[0]?.property_path).toEqual(["spi-cpol"]);
			expect(name_forbidden([finding("True")], () => schemas, () => {})[0]?.property_path).toEqual([]);
		});

		test("other findings, and a schema that can't be read, are left as they are; the schemas are read only when needed", () => {
			const other: DtValidateDiagnostic = { level: "error", node: "/soc/spi@7e204000/dac@0", property_path: ["#size-cells"], schema, schema_path: ["properties", "#size-cells", "const"], message: "0 was expected" };
			let reads = 0;
			expect(name_forbidden([other], () => { reads++; return schemas; }, () => {})).toEqual([other]);
			expect(reads).toBe(0);
			expect(name_forbidden([finding("True")], () => {}, () => new Set(["spi-cpol"]))).toEqual([finding("True")]);
		});
	});

	test("format_validation_report — empty input", () => {
		const report = format_validation_report([], node => node);
		expect(report).toEqual(["No errors!"]);
	});

	test("format_validation_report — one error and one warning", () => {
		const diagnostics: DtValidateDiagnostic[] = [
			{ level: "error", node: "/soc/spi@7e204000/dac@0", property_path: ["reg"], message: "reg is required" },
			{ level: "warning", node: "/soc/spi@7e204000/dac@0", property_path: ["spi-max-frequency"], message: "missing recommended property" },
		];
		const report = format_validation_report(diagnostics, validation_display(overlay));
		expect(report[0]).toBe("expander:");
		expect(report[1]).toContain("error: reg: reg is required");
		expect(report[2]).toContain("warning: spi-max-frequency: missing recommended property");
		expect(report).not.toContain(expect.stringContaining("No errors!"));
		expect(report.at(-1)).toBe("1 error(s), 1 warning(s)");
	});

	test("format_validation_report — warnings only", () => {
		const diagnostics: DtValidateDiagnostic[] = [
			{ level: "warning", node: "/soc/spi@7e204000/dac@0", property_path: ["spi-max-frequency"], message: "missing" },
		];
		const report = format_validation_report(diagnostics, node => node);
		expect(report.some(l => l.includes("warning"))).toBe(true);
		expect(report.at(-1)).toBe("No errors! (1 warning(s))");
	});

	test("format_validation_report — note and context are printed", () => {
		const diagnostics: DtValidateDiagnostic[] = [
			{ level: "error", node: "/soc/x", property_path: ["p"], message: "bad", note: "see spec", context: ["line 1", "line 2"] },
		];
		const report = format_validation_report(diagnostics, node => node);
		expect(report.some(l => l.includes("note: see spec"))).toBe(true);
		expect(report.some(l => l.includes("context: line 1"))).toBe(true);
		expect(report.some(l => l.includes("context: line 2"))).toBe(true);
	});

	test("reference_diagnostics — a reference that names no node, on the property, once", () => {
		const on = overlay_of(`&spi0 {
    adc@0 { reg = <0>; reset-gpios = <&gpio 26 0>, <&gpi 27 0>, <&gpi 28 0>; clocks = <&{/soc/nope}>; vref-supply = <&vref>; };
    vref: regulator@1 { reg = <1>; };
};
&nowhere {
    dev@1 { reg = <1>; interrupt-parent = <&gpio_expander>; };
};
&spi0 {
    cs-gpios = <&gpioo 8 1>;
};`);
		const diagnostics = reference_diagnostics(on);
		expect(diagnostics).toEqual([
			{
				level: "warning", node: "/soc/spi@7e204000/adc@0", property_path: ["reset-gpios"], error_type: "unresolved",
				message: "&gpi names no node: no label gpi in the base devicetree or the overlay",
			},
			{
				level: "warning", node: "/soc/spi@7e204000/adc@0", property_path: ["clocks"], error_type: "unresolved",
				message: "&{/soc/nope} names no node: no node /soc/nope in the base devicetree or the overlay",
			},
			{
				level: "warning", node: "/node1/dev@1", property_path: ["interrupt-parent"], error_type: "unresolved",
				message: "&gpio_expander names no node: no label gpio_expander in the base devicetree or the overlay",
			},
			{
				level: "warning", node: "/soc/spi@7e204000", property_path: ["cs-gpios"], error_type: "unresolved",
				message: "&gpioo names no node: no label gpioo in the base devicetree or the overlay",
			},
		]);
		expect(parse_dt_validate_output(diagnostics).warnings.map(w => w.path)).toEqual([
			["soc", "spi@7e204000", "adc@0", "reset-gpios"],
			["soc", "spi@7e204000", "adc@0", "clocks"],
			["node1", "dev@1", "interrupt-parent"],
			["soc", "spi@7e204000", "cs-gpios"],
		]);
		expect(format_validation_report(diagnostics.slice(2, 3), validation_display(on))).toEqual([
			"nowhere/dev@1:",
			"  warning: interrupt-parent: &gpio_expander names no node: no label gpio_expander in the base devicetree or the overlay",
			"No errors! (1 warning(s))",
		]);
		expect(reference_diagnostics(overlay)).toEqual([]);
	});

	test("target_diagnostics — each fragment whose target names no node, without a node, worded as import lists it", () => {
		const on = overlay_of(`/ {
    fragment@0 { target = <&spi7>; __overlay__ { dev@1 { reg = <1>; }; }; };
    fragment@1 { target = <&spi0>; __overlay__ { status = "okay"; }; };
    fragment@2 { target-path = "/soc/nope"; __overlay__ { status = "okay"; }; };
};`);
		const diagnostics = target_diagnostics(on);
		expect(diagnostics).toEqual([
			{ level: "warning", error_type: "unresolved", message: "fragment@0 targets a node the base doesn't have: target spi7" },
			{ level: "warning", error_type: "unresolved", message: "fragment@2 targets a node the base doesn't have: target-path /soc/nope" },
		]);
		expect(format_validation_report(diagnostics, node => node)).toEqual([
			"warning: fragment@0 targets a node the base doesn't have: target spi7",
			"warning: fragment@2 targets a node the base doesn't have: target-path /soc/nope",
			"No errors! (2 warning(s))",
		]);
		expect(parse_dt_validate_output(diagnostics).warnings.map(w => w.path)).toEqual([[], []]);
		expect(target_diagnostics(overlay)).toEqual([]);
	});

	test("reg_diagnostics — reg clashes join the report as warnings on reg", () => {
		const diagnostics = reg_diagnostics([{
			path: "/soc/spi@7e204000/adc@1",
			message: "chip select 0 is already used by spidev@0",
			hint: "If adc@1 replaces it: disable /soc/spi@7e204000/spidev@0",
		}]);
		expect(format_validation_report(diagnostics, validation_display(overlay))).toEqual([
			"spi0/adc@1:",
			"  warning: reg: chip select 0 is already used by spidev@0",
			"    note: If adc@1 replaces it: disable /soc/spi@7e204000/spidev@0",
			"No errors! (1 warning(s))",
		]);
		expect(parse_dt_validate_output(diagnostics)).toEqual({
			ok: true, message: "0 error(s), 1 warning(s)", severity: "warn",
			errors: [],
			warnings: [{
				kind: "generic",
				path: ["soc", "spi@7e204000", "adc@1", "reg"],
				message: "chip select 0 is already used by spidev@0; If adc@1 replaces it: disable /soc/spi@7e204000/spidev@0",
				error_type: "resource-conflict",
			}],
		});
	});
}
