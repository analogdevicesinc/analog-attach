import { get_full_node_name, type DeviceTreeOverlay, type DTNode } from "linux-lib";

import { answer, type ExtraCommand } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import { convert_property } from "../../protocol/dt-to-protocol";
import type { ListedNode, ListNodeResponse } from "../../protocol/types";
import { node_compatibles, positional_word } from "../../utilities";

/**
 * Every node of the merged tree (the base with the overlay applied), depth first in tree order,
 * the root first: where it is, its labels and compatibles, its status, and what the overlay does
 * to it, as `read` tells them (`origin`; `change` from where its properties are set). One walk of
 * the merged tree, the overlay's nodes looked up once per node.
 */
export function merged_nodes(overlay: DeviceTreeOverlay): ListedNode[] {
	return overlay.unchanged(() => {
		const merged = overlay.merged_tree()?.node_at("/");
		if (merged === undefined) { return []; }
		const nodes: ListedNode[] = [];
		const walk = (node: DTNode, path: string, base: DTNode | undefined): void => {
			const own = overlay.overlay_nodes_at(path);
			const set = new Set(own.flatMap(overlay_node => overlay_node.properties.map(property => property.name)));
			// As read has it: internal when the overlay adds the node or changes it.
			const origin = base !== undefined && own.length === 0 ? "external" : "internal";
			const from_base = node.properties.some(property => !set.has(property.name));
			// As the GUI's tree tags it (change_kind): added when nothing of it is the base's, changed when the overlay sets something.
			const change = !from_base && (set.size > 0 || origin === "internal") ? "added" : (set.size > 0 ? "changed" : "none");
			const status = node.properties.find(property => property.name === "status");
			nodes.push({
				path,
				key: path === "/" ? "/" : get_full_node_name(node),
				labels: node.labels,
				compatible: node_compatibles(node),
				...(status === undefined ? {} : { status: String(convert_property(status).value) }),
				origin,
				change,
				has_children: node.children.length > 0,
			});
			const base_children = new Map((base?.children ?? []).map(child => [get_full_node_name(child), child]));
			for (const child of node.children) {
				const name = get_full_node_name(child);
				walk(child, path === "/" ? `/${name}` : `${path}/${name}`, base_children.get(name));
			}
		};
		walk(merged, "/", overlay.get_base_dts()?.node_at("/"));
		return nodes;
	});
}

/** The filter as matched: lower case, a leading `&` dropped; undefined when nothing is left. */
function filter_word(filter: string | undefined): string | undefined {
	const word = filter?.trim().replace(/^&/, "").toLowerCase();
	return word === undefined || word === "" ? undefined : word;
}

/** Whether a node's name (with its unit address), one of its labels or one of its compatibles contains the filter word. */
export function node_matches(node: Pick<ListedNode, "key" | "labels" | "compatible">, word: string): boolean {
	return [node.key, ...node.labels, ...node.compatible].some(text => text.toLowerCase().includes(word));
}

/** The node's tags in the text: `new` (the overlay adds it), `changed`, `off` (a status other than okay). */
function node_tags(node: ListedNode): string {
	const tags = [
		...(node.change === "added" ? ["new"] : (node.change === "changed" ? ["changed"] : [])),
		...(node.status === undefined || node.status === "okay" || node.status === "ok" ? [] : ["off"]),
	];
	return tags.length === 0 ? "" : `(${tags.join(", ")})`;
}

/** What `list node` prints: a node a line in aligned columns (path, labels, compatibles, tags), then the count and how to read one. */
export function node_lines(nodes: readonly ListedNode[], message: string, program: string): string[] {
	const rows = nodes.map(node => [node.path, node.labels.map(label => `&${label}`).join(" "), node.compatible.join(", "), node_tags(node)]);
	const widths = [0, 1, 2].map(column => Math.max(0, ...rows.map(row => row[column]?.length ?? 0)));
	const line = (row: string[]): string => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd();
	return [
		...rows.map(row => line(row)),
		...(rows.length > 0 ? [""] : []),
		`${message}.`,
		`Use: ${program} read <path>`,
	];
}

/** `list node [<filter>]`: the nodes of the merged tree, or those whose name, label or compatible has the filter. */
export const list_node: ExtraCommand<Record<never, never>, ListNodeResponse> = {
	docs: {
		brief: "List the nodes of the base devicetree with the overlay applied",
		full: `Every node of the merged devicetree (the base with the overlay applied), in tree
order, by its absolute path, with its labels and compatibles: what 'read' takes.
Tagged (new) when the overlay adds it, (changed) when it sets something on it,
and (off) when its status isn't okay. With a filter, the nodes whose name,
label or compatible contains it (case-insensitive, a leading & ignored).`,
		placeholders: { filter: "filter" },
		examples: [
			"list node              Every node",
			"list node gpio         The nodes named, labelled or compatible with gpio",
			"--json list node spi   As JSON",
		],
	},
	positionals: [
		{ name: "filter", placeholder: "filter", brief: "A part of a node's name, label or compatible", optional: true },
	],
	group: "tooling",
	schema: "list-node.schema.json",
	run(arguments_, _flags, session) {
		const loaded = load_workspace(session, ["base", "overlay"]);
		if (!loaded.ok) { return Promise.resolve(loaded.outcome); }
		const filter = positional_word(arguments_, "filter");
		const word = filter_word(filter);
		const all = merged_nodes(loaded.workspace.overlay.tree);
		const nodes = word === undefined ? all : all.filter(node => node_matches(node, word));
		const count = `${nodes.length} node${nodes.length === 1 ? "" : "s"}`;
		const message = word === undefined ? count : `${count} match${nodes.length === 1 ? "es" : ""} ${JSON.stringify(filter?.trim())}`;
		return Promise.resolve(answer<ListNodeResponse>(
			{ ok: true, message, severity: "info", nodes },
			() => node_lines(nodes, message, session.program).join("\n"),
		));
	},
};

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	const node = (path: string, extra: Partial<ListedNode> = {}): ListedNode => ({
		path, key: path.split("/").at(-1) ?? path, labels: [], compatible: [], origin: "external", change: "none", has_children: false, ...extra,
	});

	test("node_matches — the name with its unit address, a label or a compatible, case-insensitive", () => {
		const gpio = node("/soc/gpio@7e200000", { labels: ["gpio"], compatible: ["brcm,bcm2711-gpio"] });
		expect(node_matches(gpio, "7e200000")).toBe(true);
		expect(node_matches(gpio, "bcm2711")).toBe(true);
		expect(node_matches(node("/leds/led-act", { labels: ["led_act"] }), "led_act")).toBe(true);
		expect(node_matches(gpio, "soc")).toBe(false);
		expect(filter_word(" &LED_act ")).toBe("led_act");
		expect(filter_word("&")).toBeUndefined();
	});

	test("node_lines — aligned columns, the tags, then the count and the Use line", () => {
		const nodes = [
			node("/soc/gpio@7e200000", { labels: ["gpio"], compatible: ["brcm,bcm2711-gpio"], status: "okay" }),
			node("/soc/spi@7e204000/adc@0", { labels: ["adc"], compatible: ["adi,ad7124-8"], origin: "internal", change: "added" }),
			node("/leds", { status: "disabled", change: "changed", origin: "internal" }),
		];
		expect(node_lines(nodes, "3 nodes match \"a\"", "aa")).toEqual([
			"/soc/gpio@7e200000       &gpio  brcm,bcm2711-gpio",
			"/soc/spi@7e204000/adc@0  &adc   adi,ad7124-8       (new)",
			`/leds${" ".repeat(46)}(changed, off)`,
			"",
			"3 nodes match \"a\".",
			"Use: aa read <path>",
		]);
		expect(node_lines([], "0 nodes match \"x\"", "aa")).toEqual(["0 nodes match \"x\".", "Use: aa read <path>"]);
	});
}
