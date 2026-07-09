import { Property } from "../ruleset_parser/types";
import { Workfile } from "../workfile_handler/types";
import { find_symbol_by_descriptor } from "../workfile_handler/utils";
import { ChildOverride, ConnectionGraph } from "./types";
import { load_resolved_ruleset } from "../resolver/resolver";

function get_connected_symbols(property: Property, workfile: Workfile): string[] {
	switch (property._t) {
		case "IncludeProperty": {
			if (typeof property.value === "string") {
				return [property.value];
			}
			return [];
		}
		case "IncludeDescriptorProperty": {
			if (typeof property.value === "string") {
				const symbol_name = find_symbol_by_descriptor(workfile, property.value);
				return symbol_name ? [symbol_name] : [];
			}
			return [];
		}
		case "UnionProperty": {
			const value = property.value as Record<string, string> | undefined;
			if (value) {
				return Object.values(value);
			}
			return [];
		}
		case "ArrayProperty": {
			if (property.element._t === "IncludeProperty" && Array.isArray(property.value)) {
				// Check if the include points to an enum - enum values are not symbol references
				const resolved = load_resolved_ruleset(property.element.include);
				if (resolved.ok && resolved.value._t === "RulesetEnum") {
					return [];
				}
				return property.value as string[];
			}
			return [];
		}
		case "PlatformExtraProperty": {
			if (typeof property.value === "string") {
				return [property.value];
			}
			return [];
		}
		default: {
			return [];
		}
	}
}

export function create_connections_graph(workfile: Workfile): ConnectionGraph {
	const graph: ConnectionGraph = new Map();

	for (const symbol_name of Object.keys(workfile.symbols)) {
		graph.set(symbol_name, []);
	}

	for (const [symbol_name, ruleset] of Object.entries(workfile.symbols)) {
		if (ruleset._t !== "RulesetStruct") {
			continue;
		}

		for (const property of ruleset.properties) {
			const children = get_connected_symbols(property, workfile);
			for (const child of children) {
				const existing = graph.get(symbol_name) ?? [];
				if (!existing.includes(child)) {
					existing.push(child);
				}
				graph.set(symbol_name, existing);
			}
		}
	}

	return graph;
}

export function is_referenced_by_others(symbol_name: string, graph: ConnectionGraph): boolean {
	for (const children of graph.values()) {
		if (children.includes(symbol_name)) {
			return true;
		}
	}
	return false;
}

export function collect_child_overrides(symbol_name: string, workfile: Workfile, graph: ConnectionGraph): ChildOverride[] {
	const children = graph.get(symbol_name) ?? [];
	const overrides: ChildOverride[] = [];

	for (const child_name of children) {
		const child = workfile.symbols[child_name];
		if (!child || child._t !== "RulesetStruct" || !child.$override) {
			continue;
		}

		for (const directive of child.$override) {
			overrides.push({directive, child });
		}
	}

	return overrides;
}
