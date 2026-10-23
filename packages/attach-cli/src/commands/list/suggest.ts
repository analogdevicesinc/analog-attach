import {
    Attach,
    AttachEnumType,
    Result as AttachResult,
    list_cell,
    DeviceTree,
    DeviceTreeOverlay,
    IntelligenceStack,
    validator_input_json,
    expand_pattern,
    get_full_node_name,
    parent_path_string,
    placement_from_overlay,
    suggest_parents,
    type AttachType,
    type DTNode,
    type PatternPropertyRule,
    type PropertyPatternRule,
    type ParsedBinding,
    type ValueSuggestion,
} from "attach-lib";
import path from "node:path";

import type { LocalContext } from "../../context";
import { load_workspace, parse_bindings, type Bindings } from "../../config/workspace";
import type { ConfigResult } from "../../config/settings";
import { format_suggestion, build_raw_property, shape_hint, parse_value } from "../update/command";
import { bigIntReplacer, effective_parent_compatibles, find_binding, fragment_target, get_compat_index, parse_property_reference, resolve_node_identifier, resolve_positional_path, resolve_write_target, type WriteTarget } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import { attach_type_to_protocol_type } from "../../protocol/dt-to-protocol";
import { find_property_definition, resolve_node_binding, type NodeBinding } from "../../binding-resolution";
import { check_value } from "../../value-check";
import { overlay_files } from "../../overlay-index";
import type { TypeResponse, Suggestion, Types } from "../../protocol/types";

export async function run_suggest(context: LocalContext, arguments_: string[]): Promise<void> {
    const kind = arguments_[0];

    if (kind === undefined) {
        if (context.json) { input_error("kind is required"); return; }
        console.log("Missing: kind (first positional argument)");
        return;
    }

    switch (kind) {
        case "parent": {
            await suggest_parent(context, arguments_.slice(1));
            return;
        }
        case "device-key": {
            await suggest_device_key(context, arguments_.slice(1));
            return;
        }
        case "overlay": {
            suggest_overlay(context, arguments_.slice(1));
            return;
        }
        case "node-prop": {
            await suggest_node_property(context, arguments_.slice(1));
            return;
        }
        case "navigate": {
            await suggest_navigate(context, arguments_.slice(1));
            return;
        }
        case "overlay-props": {
            suggest_overlay_properties(context, arguments_.slice(1));
            return;
        }
        case "children": {
            await suggest_children(context, arguments_.slice(1));
            return;
        }
        case "type": {
            await suggest_type(context, arguments_.slice(1));
            return;
        }
        case "value": {
            await suggest_value(context, arguments_.slice(1));
            return;
        }
        default: {
            if (context.json) {
                respond_fail({ ok: false, message: `Unknown suggestion kind: ${kind}`, severity: "error" });
            } else {
                console.log(`Unknown suggestion kind: ${kind}`);
            }
            return;
        }
    }
}

async function suggest_parent(context_: LocalContext, arguments_: string[]): Promise<void> {
    const compatible = arguments_[0];
    if (compatible === undefined) {
        if (context_.json) { input_error("compatible string is required for parent suggestions"); return; }
        console.log("Missing: compatible string");
        return;
    }

    const workspace = load_workspace(context_, ["bindings", "base"]);
    if (workspace === undefined) { return; }
    const { linux, dt_schema: dtSchema } = workspace.bindings;
    const dt = workspace.base.tree;

    const binding = await load_binding(context_, linux, dtSchema, compatible);
    if (binding === undefined) { return; }

    const parents = suggest_parents(dt, binding);

    const suggestions = parents.map(p => ({
        value: p.label ?? parent_path_string(p),
        display_string: parent_path_string(p),
    }));
    if (context_.json) {
        respond({ ok: true, message: `Found ${suggestions.length} valid parents`, severity: "info", suggestions });
    } else {
        for (const s of suggestions) {
            console.log(`${s.value}  ${s.display_string}`);
        }
    }
}

async function load_binding(context_: LocalContext, linux: string, dtSchema: string, compatible: string): Promise<ParsedBinding | undefined> {
    const binding_path = await find_binding(linux, dtSchema, compatible);
    if (binding_path === undefined) {
        if (context_.json) {
            respond({ ok: true, message: `No binding found for ${compatible}`, severity: "warn", suggestions: [] });
        } else {
            console.log(`Failed to find binding for ${compatible}`);
        }
        return;
    }

    const binding = await Attach.parse(binding_path, { linux, dt_schema: dtSchema });
    if (AttachResult.is_err(binding)) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Failed to parse binding ${binding_path}`, severity: "error" });
        } else {
            console.log(`Failed to parse binding ${binding_path}`);
        }
        return;
    }

    return binding.value.parsed_binding;
}

function to_suggestion(suggestion: ValueSuggestion): Suggestion {
    const display = suggestion.note !== undefined && !suggestion.display.includes(suggestion.note)
        ? `${suggestion.display} (${suggestion.note})`
        : suggestion.display;
    return {
        value: format_suggestion(suggestion),
        display_string: display,
        ...(suggestion.note === undefined ? {} : { note: suggestion.note }),
    };
}

async function suggest_value(context_: LocalContext, arguments_: string[]): Promise<void> {
    const reference = parse_property_reference(arguments_);
    if (reference === undefined) {
        if (context_.json) { input_error("prop-ref must contain a node reference and a property name"); return; }
        console.log("Missing: prop-ref (node reference followed by property name)");
        return;
    }
    const { node_identifier, property_name } = reference;

    const workspace = load_workspace(context_, ["base", "overlay"]);
    if (workspace === undefined) { return; }
    const base_dt = workspace.base.tree;
    const overlay = workspace.overlay.tree;
    // Bindings are optional here: without them suggestions are just not checked.
    const target = await resolve_target_binding(node_identifier, overlay, base_dt, parse_bindings(workspace.settings));
    const result = value_suggestions(target, overlay, base_dt, node_identifier, property_name);
    if (!result.ok) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${node_identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${node_identifier}`);
        }
        return;
    }
    const { values, suggestions } = result;

    const count = (source: string) => values.filter(value => value.source === source).length;
    const parts = [
        [count("binding"), "pinned by the binding"],
        [count("devicetree"), "from the context devicetree"],
    ].filter(([n]) => (n as number) > 0).map(([n, origin]) => `${n} value(s) ${origin}`);
    let message = parts.length > 0 ? `Found ${parts.join("; ")}` : `No values for ${property_name}`;

    if ("error" in target.binding) {
        message = `${message}; not checked against a binding (${target.binding.error})`;
    }

    if (context_.json) {
        respond({ ok: true, message, severity: "info", suggestions });
    } else {
        if (suggestions.length === 0) { console.log(message); }
        for (const suggestion of suggestions) {
            console.log(`${suggestion.value}\t${suggestion.display_string}`);
        }
    }
}

/** The node a property command targets, and its binding (or why there is none). */
export interface TargetBinding {
    target: WriteTarget;
    binding: NodeBinding | { error: string };
}

export async function resolve_target_binding(
    node_identifier: string,
    overlay: DeviceTreeOverlay,
    base_dt: DeviceTree,
    bindings: ConfigResult<Bindings>,
): Promise<TargetBinding> {
    const target = resolve_write_target(node_identifier, overlay, base_dt);
    const { binding_node, binding_parent, parent_name, parent_compatibles } = target;
    if (!bindings.ok) {
        return { target, binding: { error: bindings.errors.map(error => error.message).join("; ") } };
    }
    if (binding_node === undefined) {
        return { target, binding: { error: "node not found for binding resolution" } };
    }
    const { linux, dt_schema } = bindings.value;
    // Phandle enums are filled from the tree with the overlay applied, so they name its nodes too.
    const context = overlay.merged_tree() ?? base_dt;
    return { target, binding: await resolve_node_binding(binding_node, binding_parent, parent_name, context, linux, dt_schema, undefined, parent_compatibles) };
}

/**
 * The values the intelligence stack offers for a property, checked against
 * the binding when there is one. Undefined suggestions mean the node wasn't found.
 */
export function value_suggestions(
    { target, binding }: TargetBinding,
    overlay: DeviceTreeOverlay,
    base_dt: DeviceTree,
    node_identifier: string,
    property_name: string,
): { ok: true; values: ValueSuggestion[]; suggestions: Suggestion[] } | { ok: false } {
    const placement = placement_from_overlay(overlay, resolve_node_identifier(node_identifier, overlay));
    if (placement === undefined) { return { ok: false }; }

    const resolved = "error" in binding ? undefined : binding;
    // Pass the node's real data so the intelligence stack can resolve phandle
    // references (e.g. interrupt-parent → controller → #interrupt-cells).
    let data = "{}";
    if (target.binding_node !== undefined && resolved !== undefined) {
        data = validator_input_json(target.binding_node, resolved.properties);
    }

    // A property named by a pattern is offered to the stack under its own name.
    const pattern_definition = resolved === undefined ? undefined : find_property_definition(resolved, resolved.properties, property_name);
    const properties = resolved === undefined ? [] : [
        ...resolved.properties,
        ...(pattern_definition?.pattern === undefined ? [] : [{ key: pattern_definition.key, value: pattern_definition.value }]),
    ];
    const stack = IntelligenceStack.default();
    // The overlay's own nodes (a regulator it adds, a controller it enables) are candidates too.
    const values = stack.suggest_values(property_name, {
        devicetree: overlay.merged_tree() ?? base_dt,
        data,
        placement,
        ...(resolved === undefined ? {} : { binding: { required_properties: resolved.required_properties, properties } }),
    });

    // A clock or supply the overlay adds (its own regulator) is most likely the
    // one meant, so it goes first. The interrupt parent keeps the inherited one first.
    if (property_name === "clocks" || property_name.endsWith("-supply")) {
        const labels = overlay.all_labels();
        const added = (value: ValueSuggestion): boolean => {
            const cell = value.rows[0]?.[0];
            if (cell === undefined || typeof cell === "bigint" || !("label" in cell)) { return false; }
            return !base_dt.node_exists(cell.label) && labels.has(cell.label);
        };
        values.sort((a, b) => Number(added(b)) - Number(added(a)));
    }

    // Binding check: annotate suggestions in place, via the note field.
    if (target.binding_node !== undefined && resolved !== undefined) {
        annotate_suggestions(values, property_name, target.binding_node, resolved, base_dt, overlay);
    }

    return { ok: true, values, suggestions: values.map((value) => to_suggestion(value)) };
}

function annotate_suggestions(
    suggestions: ValueSuggestion[],
    property_name: string,
    binding_node: DTNode,
    binding: NodeBinding,
    base_dt: DeviceTree,
    overlay: DeviceTreeOverlay,
): void {
    const origin_desc = binding.origin.kind === "compatible"
        ? `${binding.origin.compatible} binding`
        : `pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;

    const is_label = (name: string): boolean => {
        if (base_dt.node_exists(name)) { return true; }
        return overlay.find_node(name) !== undefined;
    };

    for (const suggestion of suggestions) {
        const formatted = format_suggestion(suggestion);
        const preview_node = structuredClone(binding_node);

        // Build the property from the suggestion value and place it on the preview node
        const hint = shape_hint(find_property_definition(binding, binding.properties, property_name));
        const built = build_raw_property(formatted, property_name, hint, is_label);
        if (built !== null && built !== undefined && !("error" in built)) {
            const existing_index = preview_node.properties.findIndex(p => p.name === property_name);
            if (existing_index === -1) {
                preview_node.properties.push(built);
            } else {
                preview_node.properties[existing_index] = built;
            }
        }

        // Narrow and populate the binding with the preview node to get the definition
        const result = binding.narrow_and_populate(preview_node);
        if (result === undefined) { continue; }

        const definition = find_property_definition(binding, result.properties, property_name);
        if (definition === undefined) {
            suggestion.note = combine_notes(suggestion.note, `not defined by ${origin_desc}; validate may reject it`);
            continue;
        }

        if (definition.value._t === "unknown" || definition.value._t === "node") {
            continue;
        }

        // Strings are checked as they are: their text can hold commas (`adi,ad7124-4`), which parse_value reads as rows.
        const { strings } = suggestion;
        const parsed = strings === undefined ? parse_value(formatted) : (strings.length === 1 ? strings[0]! : strings);
        const check = check_value(parsed, property_name, definition);
        if (check !== true) {
            suggestion.note = combine_notes(suggestion.note, check);
        }
    }

}

function combine_notes(existing: string | undefined, addition: string): string {
    if (existing === undefined) { return addition; }
    return `${existing}; ${addition}`;
}

async function suggest_device_key(context: LocalContext, arguments_: string[]): Promise<void> {
    const filter = arguments_[0];

    const workspace = load_workspace(context, ["bindings"]);
    if (workspace === undefined) { return; }

    const index = get_compat_index(workspace.bindings);

    const entries = Object.keys(index.entries);
    const matching = filter === undefined
        ? entries
        : entries.filter(entry => entry.includes(filter));

    if (context.json) {
        const suggestions = matching.map(entry => ({ value: entry }));
        respond({ ok: true, message: `Found ${suggestions.length} devices`, severity: "info", suggestions });
    } else {
        for (const entry of matching) {
            console.log(entry);
        }
    }
}

/** The overlay file names `import` takes; only the file list, no scan. */
function suggest_overlay(context: LocalContext, arguments_: string[]): void {
    const [filter] = arguments_;
    const workspace = load_workspace(context, ["bindings"]);
    if (workspace === undefined) { return; }

    const files = overlay_files(workspace.bindings.linux);
    const matching = files.filter(file => filter === undefined || path.basename(file).startsWith(filter));
    if (context.json) {
        const suggestions = matching.map(file => ({ value: path.basename(file), display_string: file }));
        respond({ ok: true, message: `Found ${suggestions.length} overlays`, severity: "info", suggestions });
    } else {
        for (const file of matching) { console.log(path.basename(file)); }
    }
}

async function suggest_node_property(context_: LocalContext, arguments_: string[]): Promise<void> {
    const identifier = resolve_positional_path(arguments_);

    if (identifier === undefined) {
        if (context_.json) { input_error("node reference is required for node-prop suggestions"); return; }
        console.log("Missing: node reference");
        return;
    }

    const workspace = load_workspace(context_, ["bindings", "base", "overlay"]);
    if (workspace === undefined) { return; }
    const base_dt = workspace.base.tree;
    const overlay = workspace.overlay.tree;

    const found_node = effective_target_node(identifier, overlay, base_dt);
    if (found_node === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${identifier}`);
        }
        return;
    }

    const existing_keys = new Set(found_node.properties.map(p => p.name));
    const { binding } = await resolve_target_binding(identifier, overlay, base_dt, { ok: true, value: workspace.bindings });
    if ('error' in binding) {
        if (context_.json) {
            respond_fail({ ok: false, message: binding.error, severity: "error" });
        } else {
            console.log(binding.error);
        }
        return;
    }

    const required = new Set(binding.required_properties);
    const all_properties = binding.properties;
    const patterns = binding.property_patterns.map(rule => describe_property_pattern(rule, found_node));
    const children = binding.child_nodes.map(rule => describe_child_nodes(rule, found_node));

    if (context_.json) {
        const suggestions = [
            ...all_properties.map(p => {
                const labels = [
                    ...(existing_keys.has(p.key) ? ["set"] : []),
                    ...(required.has(p.key) ? ["required"] : []),
                ].join(", ");
                return {
                    value: p.key,
                    ...(labels ? { display_string: `${p.key} (${labels})` } : {}),
                };
            }),
            ...patterns,
            ...children,
        ];
        const pattern_note = patterns.length > 0 ? `, ${patterns.length} property pattern(s)` : "";
        const child_note = children.length > 0 ? ` and ${children.length} child node pattern(s)` : "";
        respond({ ok: true, message: `Found ${all_properties.length} properties${pattern_note}${child_note}`, severity: "info", suggestions });
    } else {
        for (const p of all_properties) {
            const markers = [
                ...(existing_keys.has(p.key) ? ["set"] : []),
                ...(required.has(p.key) ? ["required"] : []),
            ].join(", ");
            console.log(markers ? `${p.key} (${markers})` : p.key);
        }
        for (const pattern of patterns) { console.log(pattern.display_string); }
        for (const child of children) { console.log(child.display_string); }
    }
}

/**
 * A property pattern of the binding as a suggestion: the regex as the value,
 * and a display with the names it matches and those already set, e.g.
 * "adi,bypass-attenuator-in0 … adi,bypass-attenuator-in4 (pattern
 * ^adi,bypass-attenuator-in[0-4]$; set: adi,bypass-attenuator-in1)".
 */
export function describe_property_pattern(rule: PropertyPatternRule, node: DTNode): Suggestion {
    const pattern = new RegExp(rule.pattern);
    const set = node.properties.map(p => p.name).filter(name => pattern.test(name));
    const names = pattern_names(rule.pattern);
    const details = [names === undefined ? "pattern" : `pattern ${rule.pattern}`, ...(set.length > 0 ? [`set: ${set.join(", ")}`] : [])];
    return { value: rule.pattern, display_string: `${names ?? rule.pattern} (${details.join("; ")})` };
}

/**
 * A child-node pattern of the binding as a suggestion: the regex as the value,
 * and a display with the names it matches and the children already present,
 * e.g. "channel@0 … channel@15 (child node ^channel@([0-9]|1[0-5])$; present: channel@0)".
 */
export function describe_child_nodes(rule: PatternPropertyRule, node: DTNode): Suggestion {
    const pattern = new RegExp(rule.pattern);
    const present = node.children.map(child => get_full_node_name(child)).filter(name => pattern.test(name));
    const details = [
        `child node ${rule.pattern}`,
        `present: ${present.length > 0 ? present.join(", ") : "none"}`,
    ];
    return { value: rule.pattern, display_string: `${pattern_names(rule.pattern) ?? rule.pattern} (${details.join("; ")})` };
}

/** The names a pattern matches, short: "a, b", "first … last", or "stem…". Undefined when nothing is fixed. */
function pattern_names(pattern: string): string | undefined {
    if (!pattern.startsWith("^")) { return undefined; }
    const expansion = expand_pattern(pattern);
    if ("stem" in expansion) { return expansion.stem === "" ? undefined : `${expansion.stem}…`; }
    const { names } = expansion;
    return names.length <= 3 ? names.join(", ") : `${names[0]} … ${names.at(-1)}`;
}

/**
 * Completion candidates for a binding pattern: the names it matches that
 * aren't taken, or its stem as a partial candidate. Unanchored patterns match
 * inside any name, so they offer nothing.
 */
export function pattern_candidates(pattern: string, taken: Set<string>, kind: "pattern" | "child node"): Suggestion[] {
    if (!pattern.startsWith("^")) { return []; }
    const expansion = expand_pattern(pattern);
    if ("stem" in expansion) {
        return expansion.stem === "" ? [] : [{ value: expansion.stem, display_string: `${expansion.stem}… (${kind} ${pattern})`, partial: true }];
    }
    return expansion.names.filter(name => !taken.has(name)).map(name => ({ value: name, display_string: `${name} (${kind})` }));
}

/** The node as the base tree and the overlay together have it (update writes base nodes too); undefined when neither has it. */
export function effective_target_node(identifier: string, overlay: DeviceTreeOverlay, base_dt: DeviceTree): DTNode | undefined {
    const reference = resolve_node_identifier(identifier, overlay);
    const node_path = overlay.find_node(reference)?.node_path ?? base_dt.locate(reference)?.path;
    return node_path === undefined ? undefined : overlay.effective_node(node_path);
}

/** The properties and children of a node, from the base tree and the overlay merged; undefined when neither has it. */
export function navigate_node(identifier: string, overlay: DeviceTreeOverlay, base_dt: DeviceTree): { properties: string[]; children: string[] } | undefined {
    const node = effective_target_node(identifier, overlay, base_dt);
    const children = node_children(base_dt, overlay, identifier);
    if (node === undefined || children === undefined) { return; }
    return { properties: node.properties.map(p => p.name), children };
}

/**
 * What the property positional offers, in two groups: what the node has (its
 * children and set properties), then what it could have (the binding's unset
 * properties and the names its patterns allow). Without a binding, only the first.
 */
export function navigate_candidates(node: { properties: string[]; children: string[] }, binding?: NodeBinding): Suggestion[] {
    const children: Suggestion[] = node.children.map(child => ({ value: child, group: "set" }));
    if (binding === undefined) { return [...children, ...node.properties.map(name => ({ value: name, group: "set" }))]; }

    const required = new Set(binding.required_properties);
    const existing_keys = new Set(node.properties);
    const named = binding.properties.map(p => ({
        value: p.key,
        ...(required.has(p.key) ? { display_string: `${p.key} (required)` } : {}),
        group: existing_keys.has(p.key) ? "set" : "not set",
    }));
    // Names the binding's patterns allow: properties not set yet, child nodes not present yet.
    const taken_properties = new Set([...existing_keys, ...binding.properties.map(p => p.key)]);
    const present = new Set(node.children);
    const allowed = [
        ...binding.property_patterns.flatMap(rule => pattern_candidates(rule.pattern, taken_properties, "pattern")),
        ...binding.child_nodes.flatMap(rule => pattern_candidates(rule.pattern, present, "child node")),
    ].map(suggestion => ({ ...suggestion, group: "not set" }));
    // Set properties the binding doesn't name, or names by a pattern (status, adi,bypass-attenuator-in1).
    const named_keys = new Set(binding.properties.map(p => p.key));
    const unnamed = node.properties.filter(name => !named_keys.has(name)).map(name => ({ value: name, group: "set" }));
    return [
        ...children,
        ...named.filter(s => s.group === "set"),
        ...unnamed,
        ...named.filter(s => s.group === "not set"),
        ...allowed,
    ];
}

/** Child node names of `node`, from the base tree and the overlay merged, in first-seen order. */
export function node_children(base_dt: DeviceTree, overlay: DeviceTreeOverlay, identifier: string): string[] | undefined {
    const in_overlay = overlay.find_node(resolve_node_identifier(identifier, overlay));
    const base_identifier = base_dt.resolve_identifier(identifier);
    const in_base = base_identifier === undefined ? undefined : base_dt.locate(base_identifier)?.node;
    if (in_overlay === undefined && in_base === undefined) { return; }
    return [...new Set([
        ...(in_base?.children ?? []).map(child => get_full_node_name(child)),
        ...(in_overlay?.node.children ?? []).map(child => get_full_node_name(child)),
    ])];
}

async function suggest_children(context_: LocalContext, arguments_: string[]): Promise<void> {
    const identifier = resolve_positional_path(arguments_);
    if (identifier === undefined) {
        if (context_.json) { input_error("node reference is required for children suggestions"); return; }
        console.log("Missing: node reference");
        return;
    }

    const workspace = load_workspace(context_, ["base", "overlay"]);
    if (workspace === undefined) { return; }

    const children = node_children(workspace.base.tree, workspace.overlay.tree, identifier);
    if (children === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${identifier}`);
        }
        return;
    }

    if (context_.json) {
        respond({ ok: true, message: `Found ${children.length} child node(s)`, severity: "info", suggestions: children.map(value => ({ value })) });
    } else {
        for (const child of children) { console.log(child); }
    }
}

async function suggest_navigate(context_: LocalContext, arguments_: string[]): Promise<void> {
    const workspace = load_workspace(context_, ["base", "overlay"]);
    if (workspace === undefined) { return; }
    const base_dt = workspace.base.tree;
    const overlay = workspace.overlay.tree;

    if (arguments_.length === 0) {
        const targets = [...new Set(
            overlay.get_fragments()
                .map(fragment => fragment_target(fragment))
                .filter((target): target is string => target !== undefined)
        )];

        if (context_.json) {
            respond({ ok: true, message: `Found ${targets.length} entry points`, severity: "info", suggestions: targets.map(value => ({ value })) });
        } else {
            for (const target of targets) {
                console.log(target);
            }
        }
        return;
    }

    const identifier = resolve_positional_path(arguments_)!;
    // The node as the base and the overlay together have it: update writes base nodes too.
    const node = navigate_node(identifier, overlay, base_dt);
    if (node === undefined) {
        // The path may terminate at a property (a leaf), which has nothing to
        // navigate into but is not an error.
        const last_slash = identifier.lastIndexOf("/");
        if (last_slash > 0) {
            const parent_identifier = identifier.slice(0, last_slash);
            const property_name = identifier.slice(last_slash + 1);
            const parent = overlay.find_node(resolve_node_identifier(parent_identifier, overlay));
            if (parent !== undefined && parent.node.properties.some(p => p.name === property_name)) {
                if (context_.json) {
                    respond({ ok: true, message: `${property_name} is a property`, severity: "info", suggestions: [] });
                }
                return;
            }
        }

        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${identifier}`);
        }
        return;
    }

    // Bindings are optional here: without them the node's own properties are offered.
    const bindings = parse_bindings(workspace.settings);
    const { binding } = bindings.ok ? await resolve_target_binding(identifier, overlay, base_dt, bindings) : { binding: undefined };
    const suggestions = navigate_candidates(node, binding === undefined || "error" in binding ? undefined : binding);

    if (context_.json) {
        respond({ ok: true, message: `Found ${suggestions.length} items`, severity: "info", suggestions });
    } else {
        for (const suggestion of suggestions) {
            console.log(suggestion.display_string ?? suggestion.value);
        }
    }
}

/** The properties the overlay sets on a node: what `delete <path> <property>` can remove (a base value can only be overridden). */
function suggest_overlay_properties(context_: LocalContext, arguments_: string[]): void {
    const workspace = load_workspace(context_, ["base", "overlay"]);
    if (workspace === undefined) { return; }
    const overlay = workspace.overlay.tree;
    const identifier = resolve_positional_path(arguments_);
    const found = identifier === undefined ? undefined : overlay.find_node(resolve_node_identifier(identifier, overlay));
    const names = found === undefined ? [] : overlay.overlay_properties(found.node_path).map(p => p.name);
    const suggestions: Suggestion[] = names.map(value => ({ value, group: "set" }));
    if (context_.json) {
        respond({ ok: true, message: `Found ${suggestions.length} properties`, severity: "info", suggestions });
    } else {
        for (const { value } of suggestions) { console.log(value); }
    }
}

async function suggest_type(context_: LocalContext, arguments_: string[]): Promise<void> {
    const reference = parse_property_reference(arguments_);
    if (reference === undefined) {
        if (context_.json) { input_error("prop-ref must contain a node reference and a property name"); return; }
        console.log("Missing: prop-ref (node reference followed by property name)");
        return;
    }
    const { node_identifier, property_name } = reference;

    const workspace = load_workspace(context_, ["bindings", "base", "overlay"]);
    if (workspace === undefined) { return; }

    const report = (message: string): void => {
        if (context_.json) { respond_fail({ ok: false, message, severity: "error" }); }
        else { console.log(message); }
    };

    const { target, binding } = await resolve_target_binding(node_identifier, workspace.overlay.tree, workspace.base.tree, { ok: true, value: workspace.bindings });
    if (target.binding_node === undefined) {
        report(context_.json ? `Node ${node_identifier} not found` : `Node not found: ${node_identifier}`);
        return;
    }
    if ("error" in binding) {
        report(binding.error);
        return;
    }

    const result = property_info(binding, target.binding_node, property_name);
    if (!result.ok) {
        report(result.message);
        return;
    }
    const { info } = result;

    if (context_.json) {
        const response: TypeResponse = {
            ok: true,
            message: `Type of ${property_name}`,
            severity: "info",
            type: info.type,
            description: info.description,
            ...(info.suggestions.length > 0 ? { suggestions: info.suggestions } : {}),
        };
        respond(response);
    } else {
        const required = info.required ? " (required)" : "";
        console.log(`${property_name}${required}: ${format_type(info.type)}`);
        if (info.description !== undefined) {
            for (const line of info.description.trim().split("\n").map(l => l.trim()).filter(Boolean)) { console.log(`  ${line}`); }
        }
        const { constraints } = info;
        if (constraints.const !== undefined) { console.log(`  const: ${JSON.stringify(constraints.const, bigIntReplacer)}`); }
        if (constraints.default !== undefined) { console.log(`  default: ${JSON.stringify(constraints.default, bigIntReplacer)}`); }
        if (constraints.minimum !== undefined) { console.log(`  min: ${constraints.minimum}`); }
        if (constraints.maximum !== undefined) { console.log(`  max: ${constraints.maximum}`); }
        for (const suggestion of info.suggestions) {
            console.log(`  ${suggestion.value}\t${suggestion.display_string}`);
        }
    }
}

/** What a node's binding says about one of its properties. */
export interface PropertyInfo {
    type: Types;
    description: string | undefined;
    required: boolean;
    /** The binding YAML the definition comes from. */
    binding_path: string;
    constraints: { const?: unknown; default?: unknown; minimum?: number | bigint; maximum?: number | bigint };
    /** Values the binding's definition offers, ready for `update`. */
    suggestions: Suggestion[];
    /** For a phandle, the labels of the nodes it can name, enabled or not: candidates, not a constraint. */
    phandle_options?: string[];
}

export function property_info(
    binding: NodeBinding,
    binding_node: DTNode,
    property_name: string,
): { ok: true; info: PropertyInfo } | { ok: false; message: string } {
    const result = binding.narrow_and_populate(binding_node);
    if (result === undefined) {
        const message = binding.origin.kind === "compatible"
            ? `Failed to narrow binding for ${binding.origin.compatible}`
            : `Failed to validate against pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;
        return { ok: false, message };
    }

    const property_definition = find_property_definition(binding, result.properties, property_name);
    if (property_definition === undefined) {
        const origin_desc = binding.origin.kind === "compatible"
            ? `${binding.origin.compatible} binding`
            : `pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;
        return { ok: false, message: `Property ${property_name} not found in ${origin_desc}` };
    }

    const constraints = type_constraints(property_definition.value);
    return {
        ok: true,
        info: {
            type: attach_type_to_protocol_type(property_definition.value),
            description: property_definition.value.description,
            required: binding.required_properties.includes(property_name),
            binding_path: binding.binding_path,
            constraints: {
                ...(constraints.const === undefined ? {} : { const: constraints.const }),
                ...(constraints.default === undefined ? {} : { default: constraints.default }),
                ...(constraints.minimum === undefined ? {} : { minimum: constraints.minimum }),
                ...(constraints.maximum === undefined ? {} : { maximum: constraints.maximum }),
            },
            suggestions: (property_definition.suggestions ?? []).map((suggestion) => to_suggestion(suggestion)),
            ...(constraints.phandle_options === undefined ? {} : { phandle_options: constraints.phandle_options }),
        },
    };
}

/** What a binding says about the values of a property: a const, a default, a range, the nodes a phandle can name. */
function type_constraints(type: AttachType): { const?: bigint | string; default?: bigint | string; minimum?: bigint; maximum?: bigint; phandle_options?: string[] } {
    const cell = type._t === "scalar" ? type.cell : (type._t === "list" ? list_cell(type) : undefined);
    if (cell === undefined || cell._t === "string" || cell._t === "any") { return {}; }
    const own_default = type._t === "scalar" ? type.default : cell.default;
    if (cell._t === "number") {
        return {
            ...(own_default === undefined ? {} : { default: own_default }),
            ...(cell.minimum === undefined ? {} : { minimum: cell.minimum }),
            ...(cell.maximum === undefined ? {} : { maximum: cell.maximum }),
        };
    }
    // A phandle enum's default is the value currently set (a preselect), not the binding's.
    if (cell.enum_type === AttachEnumType.PHANDLE) { return { phandle_options: cell.enum.map(String) }; }
    // A scalar whose only option is its default is a const.
    if (type._t === "scalar" && cell.enum.length === 1 && cell.enum[0] === own_default) { return { const: own_default }; }
    return own_default === undefined ? {} : { default: own_default };
}

/** `2`, `1..4`, `2..`; nothing when the binding only says "one or more". */
function count_range(min = 0, max?: number): string {
    if (max === undefined) { return min <= 1 ? "" : `${min}..`; }
    return min === max ? String(max) : `${min}..${max}`;
}

export function format_type(type: Types): string {
    switch (type.kind) {
        case "number": {
            return "number";
        }
        case "string": {
            return "string";
        }
        case "bool": {
            return "bool";
        }
        case "enum": {
            return `enum(${type.options.map(o => String(o.display_string ?? o.value)).join(" | ")})`;
        }
        case "array": {
            return `${format_type(type.items)}[${count_range(type.min_items, type.max_items)}]`;
        }
        case "tuple": {
            return `(${type.items.map((element) => format_type(element)).join(", ")})`;
        }
    }
}

if (import.meta.vitest) {
    const { test, expect, describe } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO } = await import("attach-lib");

    const navigate_trees = (overlay_source: string): { base: DeviceTree; overlay: DeviceTreeOverlay } => {
        const base = DT.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t\tcompatible = "brcm,bcm2835-spi";\n\t\t\tstatus = "disabled";\n\t\t\tspidev0: spidev@0 {\n\t\t\t\treg = <0>;\n\t\t\t};\n\t\t};\n\t\tgpio: gpio@7e200000 {\n\t\t\tcompatible = "brcm,bcm2711-gpio";\n\t\t\tpin_a {\n\t\t\t};\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(overlay_source, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return { base, overlay };
    };

    test("navigate_node — a base node the overlay doesn't touch: its base properties and children", () => {
        const { base, overlay } = navigate_trees(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tstatus = "okay";\n};`);
        expect(navigate_node("gpio", overlay, base)).toEqual({ properties: ["compatible"], children: ["pin_a"] });
    });

    test("navigate_node — a base node the overlay changes: base and overlay merged", () => {
        const { base, overlay } = navigate_trees(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tstatus = "okay";\n\tcs-gpios = <&gpio 8 1>;\n\tadc@1 {\n\t\treg = <1>;\n\t};\n};`);
        expect(navigate_node("spi0", overlay, base)).toEqual({ properties: ["compatible", "status", "cs-gpios"], children: ["spidev@0", "adc@1"] });
        expect(navigate_node("spi0/adc@1", overlay, base)).toEqual({ properties: ["reg"], children: [] });
        expect(navigate_node("nope", overlay, base)).toBeUndefined();
    });

    test("navigate_candidates — what is there (children, set properties), then what is not (unset properties, pattern names)", () => {
        const binding: NodeBinding = {
            properties: [
                { key: "compatible", value: { _t: "unknown", description: "" } },
                { key: "cs-gpios", value: { _t: "unknown", description: "" } },
                { key: "num-cs", value: { _t: "unknown", description: "" } },
            ],
            required_properties: ["compatible"],
            child_nodes: [],
            property_patterns: [],
            binding_path: "/linux/spi/brcm,bcm2835-spi.yaml",
            origin: { kind: "compatible", compatible: "brcm,bcm2835-spi" },
            narrow_and_populate: () => ({ properties: [], errors: [] }),
        };
        expect(navigate_candidates({ properties: ["compatible", "cs-gpios"], children: ["spidev@0"] }, binding)).toEqual([
            { value: "spidev@0", group: "set" },
            { value: "compatible", display_string: "compatible (required)", group: "set" },
            { value: "cs-gpios", group: "set" },
            { value: "num-cs", group: "not set" },
        ]);
        // What the binding doesn't name, or names by a pattern, is still set.
        expect(navigate_candidates({ properties: ["compatible", "status", "adi,bypass-attenuator-in1"], children: [] }, {
            ...binding,
            property_patterns: [{ pattern: "^adi,bypass-attenuator-in[0-2]$", description: "", value: { _t: "unknown", description: "" } }],
        })).toEqual([
            { value: "compatible", display_string: "compatible (required)", group: "set" },
            { value: "status", group: "set" },
            { value: "adi,bypass-attenuator-in1", group: "set" },
            { value: "cs-gpios", group: "not set" },
            { value: "num-cs", group: "not set" },
            { value: "adi,bypass-attenuator-in0", display_string: "adi,bypass-attenuator-in0 (pattern)", group: "not set" },
            { value: "adi,bypass-attenuator-in2", display_string: "adi,bypass-attenuator-in2 (pattern)", group: "not set" },
        ]);
        expect(navigate_candidates({ properties: [], children: [] }, { ...binding, required_properties: ["num-cs"] }).at(-1))
            .toEqual({ value: "num-cs", display_string: "num-cs (required)", group: "not set" });
        expect(navigate_candidates({ properties: ["compatible", "status"], children: ["spidev@0"] }))
            .toEqual([{ value: "spidev@0", group: "set" }, { value: "compatible", group: "set" }, { value: "status", group: "set" }]);
    });

    test("property_info — a pattern property's type and description; an empty default is left out", () => {
        const value: AttachType = { _t: "list", item: { _t: "enum", enum: ["pwm2", "smbalert#"], enum_type: AttachEnumType.STRING }, minItems: 1, maxItems: 1, description: "Pin 5 function" };
        const binding: NodeBinding = {
            properties: [],
            required_properties: [],
            child_nodes: [],
            property_patterns: [{ pattern: "^adi,pin(5|10)-function$", description: "", value }],
            binding_path: "/linux/hwmon/adt7475.yaml",
            origin: { kind: "compatible", compatible: "adi,adt7475" },
            narrow_and_populate: () => ({ properties: [], errors: [] }),
        };
        const result = property_info(binding, { name: "hwmon", labels: [], properties: [], children: [] } as unknown as DTNode, "adi,pin5-function");
        expect(result.ok && result.info.description).toBe("Pin 5 function");
        expect(result.ok && result.info.constraints).toEqual({});
        expect(result.ok && result.info.phandle_options).toBeUndefined();
    });

    test("property_info — a phandle enum's options are the nodes it can name, not a constraint", () => {
        const value: AttachType = { _t: "list", item: { _t: "enum", enum: ["gpio", "gicv2", "aon_intr"], default: "gpio", enum_type: AttachEnumType.PHANDLE }, minItems: 1, maxItems: 1, description: "" };
        const binding: NodeBinding = {
            properties: [{ key: "interrupt-parent", value }],
            required_properties: [],
            child_nodes: [],
            property_patterns: [],
            binding_path: "/linux/iio/adc/adi,ad7124.yaml",
            origin: { kind: "compatible", compatible: "adi,ad7124-8" },
            narrow_and_populate: () => ({ properties: [{ key: "interrupt-parent", value }], errors: [] }),
        };
        const result = property_info(binding, { name: "adc", labels: [], properties: [], children: [] } as unknown as DTNode, "interrupt-parent");
        expect(result.ok && result.info.phandle_options).toEqual(["gpio", "gicv2", "aon_intr"]);
    });

    test("value_suggestions — a regulator the overlay adds is a supply candidate, listed first", () => {
        const base = DT.new_from_string(`/dts-v1/;\n/ {\n\tvdd_3v3_reg: fixedregulator_3v3 {\n\t\tcompatible = "regulator-fixed";\n\t\tregulator-min-microvolt = <3300000>;\n\t};\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t\tcompatible = "brcm,bcm2835-spi";\n\t\t\t#address-cells = <1>;\n\t\t\t#size-cells = <0>;\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n&{/} {\n\tvref: fixedregulator@0 {\n\t\tcompatible = "regulator-fixed";\n\t\tregulator-min-microvolt = <2500000>;\n\t};\n};\n&spi0 {\n\tadc@0 {\n\t\tcompatible = "adi,ad7124-8";\n\t\treg = <0>;\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const target: TargetBinding = { target: resolve_write_target("spi0/adc@0", overlay, base), binding: { error: "no bindings" } };
        const result = value_suggestions(target, overlay, base, "spi0/adc@0", "refin1-supply");
        expect(result.ok && result.suggestions.map(s => s.value)).toEqual(["vref", "vdd_3v3_reg"]);
    });

    test("describe_property_pattern — the names it expands to, the regex, and the names already set", () => {
        const node = { name: "hwmon", labels: [], properties: [{ name: "adi,bypass-attenuator-in1", value: [] }, { name: "reg", value: [] }], children: [] } as unknown as DTNode;
        const rule = { pattern: "^adi,bypass-attenuator-in[0-4]$", description: "", value: { _t: "unknown" } as const };
        expect(describe_property_pattern(rule, node)).toEqual({
            value: "^adi,bypass-attenuator-in[0-4]$",
            display_string: "adi,bypass-attenuator-in0 … adi,bypass-attenuator-in4 (pattern ^adi,bypass-attenuator-in[0-4]$; set: adi,bypass-attenuator-in1)",
        });
        expect(describe_property_pattern({ ...rule, pattern: "^adi,pin(5|10)-function$" }, { ...node, properties: [] }).display_string)
            .toBe("adi,pin5-function, adi,pin10-function (pattern ^adi,pin(5|10)-function$)");
        expect(describe_property_pattern({ ...rule, pattern: ".*-supply$" }, node).display_string).toBe(".*-supply$ (pattern)");
    });

    test("describe_child_nodes — the names, or the stem, in place of the regex", () => {
        const channel = { name: "channel", unit_addr: "0", labels: [], properties: [], children: [] };
        const node = { name: "adc", labels: [], properties: [], children: [channel] } as unknown as DTNode;
        const rule = { pattern: "^channel@([0-9]|1[0-5])$", description: "", properties: [], required: [] };
        expect(describe_child_nodes(rule, node).display_string).toBe("channel@0 … channel@15 (child node ^channel@([0-9]|1[0-5])$; present: channel@0)");
        expect(describe_child_nodes({ ...rule, pattern: "^fan-[0-9]+$" }, node).display_string).toBe("fan-… (child node ^fan-[0-9]+$; present: none)");
    });

    test("pattern_candidates — names not taken yet, or the stem as a partial candidate", () => {
        expect(pattern_candidates("^channel@[0-3]$", new Set(["channel@1"]), "child node")).toEqual([
            { value: "channel@0", display_string: "channel@0 (child node)" },
            { value: "channel@2", display_string: "channel@2 (child node)" },
            { value: "channel@3", display_string: "channel@3 (child node)" },
        ]);
        expect(pattern_candidates("^fan-[0-9]+$", new Set(), "child node")).toEqual([{ value: "fan-", display_string: "fan-… (child node ^fan-[0-9]+$)", partial: true }]);
        // Unanchored patterns match inside any name; no fixed text gives nothing to type.
        expect(pattern_candidates("-supply$", new Set(), "pattern")).toEqual([]);
        expect(pattern_candidates("^.*-supply$", new Set(), "pattern")).toEqual([]);
    });
    type VS = import("attach-lib").ValueSuggestion;

    // ── to_suggestion ──────────────────────────────────────────────────

    test("to_suggestion — carries note and appends it to display once", () => {
        const suggestion: VS = { rows: [[19n, { macro: "IRQ_TYPE_EDGE_FALLING" }]], display: "19 IRQ_TYPE_EDGE_FALLING", source: "board:test", note: "needs interrupt-parent" };
        const result = to_suggestion(suggestion);
        expect(result.note).toBe("needs interrupt-parent");
        expect(result.display_string).toBe("19 IRQ_TYPE_EDGE_FALLING (needs interrupt-parent)");
    });

    test("to_suggestion — does not duplicate note already in display", () => {
        const suggestion: VS = { rows: [[0n]], display: "0 — in use by spidev@0 (in use by spidev@0)", source: "board:test", note: "in use by spidev@0" };
        const result = to_suggestion(suggestion);
        expect(result.note).toBe("in use by spidev@0");
        expect(result.display_string).not.toContain("(in use by spidev@0) (in use by spidev@0)");
    });

    test("to_suggestion — no note means no note field", () => {
        const suggestion: VS = { rows: [[1n]], display: "1", source: "board:test" };
        const result = to_suggestion(suggestion);
        expect(result.note).toBeUndefined();
        expect(result.display_string).toBe("1");
    });

    // ── to_suggestion with board-layer-shaped suggestions ──────────────

    test("to_suggestion — matrix rows produce comma-separated --with value", () => {
        const suggestion: VS = {
            rows: [[{ label: "gpio" }, 8n, { macro: "GPIO_ACTIVE_LOW" }], [{ label: "gpio" }, 7n, { macro: "GPIO_ACTIVE_LOW" }]],
            display: "2 chip selects — GPIO8, GPIO7",
            source: "board:PMD-RPI-INTZ",
        };
        const result = to_suggestion(suggestion);
        expect(result.value).toBe("gpio 8 GPIO_ACTIVE_LOW,gpio 7 GPIO_ACTIVE_LOW");
        expect(result.display_string).toBe("2 chip selects — GPIO8, GPIO7");
    });

    test("to_suggestion — single-row label+number+macro formats as space-separated value", () => {
        const suggestion: VS = {
            rows: [[{ label: "gpio" }, 19n, { macro: "IRQ_TYPE_EDGE_FALLING" }]],
            display: "gpio 19 IRQ_TYPE_EDGE_FALLING — spi_pmod1.int",
            source: "board:PMD-RPI-INTZ",
            slots: ["spi_pmod1"],
        };
        const result = to_suggestion(suggestion);
        expect(result.value).toBe("gpio 19 IRQ_TYPE_EDGE_FALLING");
    });

    test("to_suggestion — single-cell reg", () => {
        const suggestion: VS = { rows: [[2n]], display: "2 — GPIO20 (spi_pmod1.cs2)", source: "board:PMD-RPI-INTZ", slots: ["spi_pmod1"] };
        const result = to_suggestion(suggestion);
        expect(result.value).toBe("2");
    });

    // ── parse_property_reference ────────────────────────────────────────

    describe("parse_property_reference", () => {
        test("single segment with slash separates node and property", () => {
            expect(parse_property_reference(["mynode/status"])).toStrictEqual({
                node_identifier: "mynode",
                property_name: "status",
            });
        });

        test("multi-segment path splits at last slash", () => {
            expect(parse_property_reference(["spi0", "adc@0", "reg"])).toStrictEqual({
                node_identifier: "spi0/adc@0",
                property_name: "reg",
            });
        });

        test("root-relative path", () => {
            expect(parse_property_reference(["/soc/spi@7e204000/adc@0/interrupts"])).toStrictEqual({
                node_identifier: "/soc/spi@7e204000/adc@0",
                property_name: "interrupts",
            });
        });

        test("returns undefined for empty input", () => {
            expect(parse_property_reference([])).toBeUndefined();
        });

        test("returns undefined when no slash is present (no property name)", () => {
            expect(parse_property_reference(["status"])).toBeUndefined();
        });
    });

    // ── format_type ────────────────────────────────────────────────────

    describe("format_type", () => {
        test("number", () => {
            expect(format_type({ kind: "number", subtype: "int" })).toBe("number");
        });

        test("string", () => {
            expect(format_type({ kind: "string" })).toBe("string");
        });

        test("bool", () => {
            expect(format_type({ kind: "bool" })).toBe("bool");
        });

        test("enum with string options", () => {
            expect(format_type({ kind: "enum", options: [{ value: "okay" }, { value: "disabled" }] }))
                .toBe("enum(okay | disabled)");
        });

        test("enum with display_string options", () => {
            expect(format_type({ kind: "enum", options: [{ value: 0, display_string: "IRQ_TYPE_NONE" }] }))
                .toBe("enum(IRQ_TYPE_NONE)");
        });

        test("array of numbers", () => {
            expect(format_type({ kind: "array", items: { kind: "number", subtype: "int" } }))
                .toBe("number[]");
        });

        test("array with the binding's item counts", () => {
            const number = { kind: "number", subtype: "int" } as const;
            expect(format_type({ kind: "array", items: number, min_items: 2, max_items: 2 })).toBe("number[2]");
            expect(format_type({ kind: "array", items: number, min_items: 1, max_items: 4 })).toBe("number[1..4]");
            expect(format_type({ kind: "array", items: number, min_items: 2 })).toBe("number[2..]");
            expect(format_type({ kind: "array", items: number, min_items: 1 })).toBe("number[]");
            expect(format_type({ kind: "array", items: number, min_items: 0, max_items: 3 })).toBe("number[0..3]");
            expect(format_type({ kind: "array", items: { kind: "array", items: number, min_items: 2, max_items: 2 } })).toBe("number[2][]");
        });

        test("tuple", () => {
            expect(format_type({
                kind: "tuple",
                items: [
                    { kind: "number", subtype: "int" },
                    { kind: "enum", options: [{ value: "IRQ_TYPE_EDGE_FALLING" }] },
                ],
            })).toBe("(number, enum(IRQ_TYPE_EDGE_FALLING))");
        });

        test("nested array of enums", () => {
            expect(format_type({
                kind: "array",
                items: { kind: "enum", options: [{ value: 0 }, { value: 1 }] },
            })).toBe("enum(0 | 1)[]");
        });
    });

    // ── combine_notes ──────────────────────────────────────────────────

    describe("combine_notes", () => {
        test("appends to existing note with semicolon", () => {
            expect(combine_notes("in use by spidev@0", "binding rejects it")).toBe("in use by spidev@0; binding rejects it");
        });

        test("returns addition when no existing note", () => {
            expect(combine_notes(undefined, "not defined by binding")).toBe("not defined by binding");
        });
    });
}
