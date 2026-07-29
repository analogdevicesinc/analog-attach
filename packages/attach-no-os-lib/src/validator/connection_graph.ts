import type { Property } from "../ruleset_parser/types";
import type { Workfile } from "../workfile_handler/types";
import type { CollectedRule, ConnectionGraph } from "./types";
import { load_resolved_ruleset } from "../resolver/resolver";

export function get_connected_symbols(property: Property): string[] {
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

// Rewrite every reference to `old_name` across all symbols to `new_name`. Mutates
// property values in place, mirroring get_connected_symbols' knowledge of which
// property shapes hold symbol references. Shapes with no references fall through.
export function rename_symbol_references(workfile: Workfile, old_name: string, new_name: string): void {
	for (const ruleset of Object.values(workfile.symbols)) {
		// Only struct and descriptor nodes carry properties that can reference symbols.
		if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor") {
			continue;
		}
		for (const property of ruleset.properties) {
			switch (property._t) {
				case "IncludeProperty":
				case "PlatformExtraProperty": {
					if (property.value === old_name) {
						property.value = new_name;
					}
					break;
				}
				case "UnionProperty": {
					const value = property.value as Record<string, string> | undefined;
					if (value) {
						for (const [member, target] of Object.entries(value)) {
							if (target === old_name) {
								value[member] = new_name;
							}
						}
					}
					break;
				}
				case "ArrayProperty": {
					if (property.element._t === "IncludeProperty" && Array.isArray(property.value)) {
						// Enum-backed includes hold enum values, not symbol references.
						const resolved = load_resolved_ruleset(property.element.include);
						if (resolved.ok && resolved.value._t === "RulesetEnum") {
							break;
						}
						property.value = (property.value as string[]).map(v => v === old_name ? new_name : v);
					}
					break;
				}
				default:
			}
		}
	}
}

export function create_connections_graph(workfile: Workfile): ConnectionGraph {
	const graph: ConnectionGraph = new Map();

	for (const symbol_name of Object.keys(workfile.symbols)) {
		graph.set(symbol_name, []);
	}

	for (const [symbol_name, ruleset] of Object.entries(workfile.symbols)) {
		// Descriptor nodes also carry properties (their single `init_param` include),
		// so the descriptor -> init_param edge is part of the graph.
		if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor") {
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

// Topological order of symbol names, dependencies before dependents. Seeds
// out-degree = children.length and decrements a parent when one of its children is
// emitted, so the emit order is deterministic and stable for identical graphs. Used
// by codegen to lay symbols out with every referenced struct declared before the
// struct that references it. Throws on a dependency cycle.
export function topo_sorted_symbols(workfile: Workfile): string[] {
	const graph = create_connections_graph(workfile);
	const in_degree = new Map<string, number>();

	for (const name of graph.keys()) {
		in_degree.set(name, 0);
	}
	for (const [parent, children] of graph) {
		in_degree.set(parent, children.length);
	}

	const queue: string[] = [];
	for (const [name, degree] of in_degree) {
		if (degree === 0) {
			queue.push(name);
		}
	}

	const sorted: string[] = [];
	while (queue.length > 0) {
		const name = queue.shift();
		if (name === undefined) {
			continue;
		}
		sorted.push(name);

		for (const [parent, children] of graph) {
			if (children.includes(name)) {
				const new_degree = (in_degree.get(parent) ?? 1) - 1;
				in_degree.set(parent, new_degree);
				if (new_degree === 0) {
					queue.push(parent);
				}
			}
		}
	}

	if (sorted.length !== graph.size) {
		const in_cycle = [...graph.keys()].filter(name => !sorted.includes(name));
		throw new Error(`Dependency cycle detected among symbols: ${in_cycle.join(", ")}`);
	}

	return sorted;
}

// Rebuild `workfile.symbols` in topological (dependency-first) order, in place.
// JS objects preserve insertion order, so after this every `Object.entries(symbols)`
// — in codegen templates and elsewhere — walks symbols with each referenced struct
// ahead of its referrer. Codegen relies on this instead of sorting inside templates.
export function reorder_symbols_topologically(workfile: Workfile): void {
	const ordered = topo_sorted_symbols(workfile);
	const reordered: Workfile["symbols"] = {};
	for (const name of ordered) {
		const symbol = workfile.symbols[name];
		if (symbol !== undefined) {
			reordered[name] = symbol;
		}
	}
	workfile.symbols = reordered;
}

export function is_referenced_by_others(symbol_name: string, graph: ConnectionGraph): boolean {
	for (const children of graph.values()) {
		if (children.includes(symbol_name)) {
			return true;
		}
	}
	return false;
}

// The first symbol that includes `symbol_name` (decision: assume single parent).
// A rule declared on X that references `parent` reads from / writes to this symbol.
function find_includer(symbol_name: string, graph: ConnectionGraph): string | undefined {
	for (const [candidate, children] of graph.entries()) {
		if (children.includes(symbol_name)) {
			return candidate;
		}
	}
	return undefined;
}

// Collect every rule that can affect `symbol_name`, with its refs pre-resolved to
// concrete symbol names. A rule declared on symbol D has self = D and parent =
// D's includer; it affects `symbol_name` when `symbol_name` is D itself (self
// effects) or D's includer (parent effects). We therefore gather rules from two
// sources:
//   1. `symbol_name`'s own rules   — self = symbol_name, parent = its includer
//   2. each child's rules          — self = child,       parent = symbol_name
// resolving both refs once here (decision: resolve at collection time) so
// apply_overrides never re-decides scope.
export function collect_child_overrides(symbol_name: string, workfile: Workfile, graph: ConnectionGraph): CollectedRule[] {
	const collected: CollectedRule[] = [];

	const self = workfile.symbols[symbol_name];
	if (self?._t === "RulesetStruct" && self.rules) {
		const parent_symbol = find_includer(symbol_name, graph);
		for (const rule of self.rules) {
			collected.push({ rule, self_symbol: symbol_name, parent_symbol });
		}
	}

	for (const child_name of graph.get(symbol_name) ?? []) {
		const child = workfile.symbols[child_name];
		if (child?._t !== "RulesetStruct" || !child.rules) {
			continue;
		}

		for (const rule of child.rules) {
			collected.push({ rule, self_symbol: child_name, parent_symbol: symbol_name });
		}
	}

	return collected;
}
