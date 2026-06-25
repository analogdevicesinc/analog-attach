import { Property } from "../bindings_parser/types";
import { Workfile } from "../workfile_handler/types";
import { ChildOverride, ConnectionGraph } from "./types";

function get_connected_symbols(property: Property): string[] {
	switch (property._t) {
		case "IncludeProperty": {
			if (typeof property.value === "string") {
				return [property.value];
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
		if (ruleset._t !== "BindingStuct") {
			continue;
		}

		for (const property of ruleset.properties) {
			const children = get_connected_symbols(property);
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

export function collect_child_overrides(symbol_name: string, workfile: Workfile, graph: ConnectionGraph): ChildOverride[] {
	const children = graph.get(symbol_name) ?? [];
	const overrides: ChildOverride[] = [];

	for (const child_name of children) {
		const child = workfile.symbols[child_name];
		if (!child || child._t !== "BindingStuct" || !child.$override) {
			continue;
		}

		for (const directive of child.$override) {
			overrides.push({directive, child });
		}
	}

	return overrides;
}
