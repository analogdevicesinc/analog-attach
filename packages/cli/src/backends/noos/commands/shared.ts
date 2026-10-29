import fs from "node:fs";
import path from "node:path";
import {
    error,
    export_minimal,
    get_effective_setting_value,
    get_workfile_path,
    import_minimal,
    load_minimal_workfile,
    ok,
    type MinimalWorkfile,
    type Property,
    type PropertySuggestions,
    type Result,
    type Ruleset,
    type RulesetDescriptor,
    type RulesetStruct,
    type Workfile,
} from "attach-no-os-lib";
import type { Session } from "../../../interface/backend-interface";
import { RESERVED_PREFIX } from "../protocol/convert";
import { install } from "../settings";

// --- Types ---

export type WorkfileContext = {
    path: string;
    minimal: MinimalWorkfile;
    workfile: Workfile;
};

// --- Workfile Loading ---

/**
 * The configured workfile, loaded. Installs the session's settings into the lib first
 * (see `install`), so a command that starts here needs nothing else.
 */
export function load_context(session: Pick<Session, "settings" | "assets_dir" | "program">): Result<WorkfileContext> {
    install(session);
    const resolved = get_workfile_path();
    if (!resolved.ok) {
        return resolved;
    }

    const path = resolved.value;
    if (!fs.existsSync(path)) {
        return error(`No workfile at '${path}'. Create one with '${session.program} init', or point the 'workfile' setting elsewhere.`);
    }

    const minimal = load_minimal_workfile(path);
    if (!minimal.ok) {
        return minimal;
    }

    const workfile = import_minimal(minimal.value);
    if (!workfile.ok) {
        return workfile;
    }

    return ok({ path, minimal: minimal.value, workfile: workfile.value });
}

/**
 * The root node's key.
 *
 * A path never names the root — an empty path *is* the root — so this only has to be
 * recognisable, and the workfile's own name is the most recognisable thing there is. `read` needs it because a `Node` must have a key; `add` needs it to explain that the
 * root is the only place a node can go.
 */
export function root_key(context: WorkfileContext): string {
    return path.basename(context.path, path.extname(context.path));
}

// --- Project Location ---

/**
 * Name of the project `generate` writes.
 *
 * `generate` takes no arguments, so the name comes from the `project-name` setting — and
 * when that is unset, from the workfile's own directory, which is the name of the thing
 * being built in every layout we have seen.
 */
export function get_project_name(context: WorkfileContext): Result<string> {
    const configured = get_effective_setting_value("project-name");
    if (!configured.ok) {
        return configured;
    }

    return ok(configured.value || path.basename(path.dirname(context.path)));
}

/** Where projects go when `project-path` is unset: `out/<project-name>`. */
export const DEFAULT_PROJECT_DIRECTORY = "out";

/** The directory that holds `.analog-attach/`: the session's state directory is `<root>/.analog-attach/noos`. */
export function project_root(session: Pick<Session, "state_dir">): string {
    return path.dirname(path.dirname(session.state_dir));
}

/**
 * Directory of the generated project: the one `generate` writes, and `build` and `deploy`
 * act on.
 *
 * `project-path` names it outright (absolute: the front end resolves a relative one against
 * the project root). Unset, it is `out/<project-name>` in the project root, so all three
 * agree on where the project is without any setting.
 */
export function get_project_path(session: Pick<Session, "settings" | "assets_dir" | "state_dir">): Result<string> {
    install(session);
    const configured = get_effective_setting_value("project-path");
    if (!configured.ok) {
        return configured;
    }

    if (configured.value) {
        return ok(path.resolve(configured.value));
    }

    const name = get_effective_setting_value("project-name");
    if (!name.ok) {
        return name;
    }

    // The same default `generate` uses (get_project_name): named after the folder the
    // workfile is in, so `build` finds what `generate` wrote without any setting.
    let project_name = name.value;
    if (!project_name) {
        // Resolved the way every command resolves it, so a `workfile` set to a folder names
        // the workfile inside it here too.
        const workfile = get_workfile_path();
        if (!workfile.ok) {
            return workfile;
        }
        project_name = path.basename(path.dirname(workfile.value));
    }

    return ok(path.join(project_root(session), DEFAULT_PROJECT_DIRECTORY, project_name));
}

// --- Workfile Saving ---

export function save_workfile(context: WorkfileContext): Result<void> {
    const minimal = export_minimal(context.workfile);
    if (!minimal.ok) {
        return minimal;
    }

    fs.writeFileSync(context.path, JSON.stringify(minimal.value, undefined, 2));
    return ok();
}

// --- Node/Property Lookup ---

export type NodePropertyResult = {
    node: RulesetStruct | RulesetDescriptor;
    property: Property;
};

/**
 * The property `name` refers to, supplying a leading `$` if that is what it takes to match.
 *
 * `$init_param` is the property people type most, and `$` is the one character a shell will
 * not hand us: unquoted, `$init_param` expands to nothing, so it has to be written
 * `'$init_param'` every single time. Accepting a bare `init_param` costs nothing and spares
 * that. An exact match always wins, so a schema that one day declares a real `init_param`
 * field keeps it, and a name that matches neither form is returned unchanged so the caller
 * reports it the way the user typed it.
 *
 * Callers should use the resolved name from here on — `lookup.value.property.name` after a
 * `get_node_property`, which is always the canonical one — since the lib only knows the
 * workfile's own spelling.
 */
export function resolve_property_name(
    node: RulesetStruct | RulesetDescriptor,
    name: string
): string {
    if (node.properties.some(candidate => candidate.name === name)) {
        return name;
    }

    const reserved = `${RESERVED_PREFIX}${name}`;
    return node.properties.some(candidate => candidate.name === reserved) ? reserved : name;
}

export function get_node_property(
    context: WorkfileContext,
    node_name: string,
    property_name: string
): Result<NodePropertyResult> {
    const node = context.workfile.symbols[node_name];
    if (!node) {
        return error(`Node '${node_name}' not found. Available: ${Object.keys(context.workfile.symbols).join(", ")}`);
    }

    if (node._t !== "RulesetStruct" && node._t !== "RulesetDescriptor") {
        return error(`Node '${node_name}' is not a struct or descriptor`);
    }

    const resolved = resolve_property_name(node, property_name);
    const property = node.properties.find(p => p.name === resolved);
    if (!property) {
        return error(`Property '${property_name}' not found. Available: ${node.properties.map(p => p.name).join(", ")}`);
    }

    return ok({ node, property });
}

// For commands that work on a node's properties. An extern has none, so it is rejected here.
export function get_node(context: WorkfileContext, node_name: string): Result<RulesetStruct | RulesetDescriptor> {
    const node = get_any_node(context, node_name);
    if (!node.ok) {
        return node;
    }

    if (node.value._t !== "RulesetStruct" && node.value._t !== "RulesetDescriptor") {
        return error(`Node '${node_name}' has no properties to configure`);
    }

    return ok(node.value);
}

// For commands that only need the node to exist - `delete`, `read <node>`. Any kind the user can create counts, including an
// extern, which is a name with nothing to set.
export function get_any_node(context: WorkfileContext, node_name: string): Result<Ruleset> {
    const node = context.workfile.symbols[node_name];
    if (!node) {
        return error(`Node '${node_name}' not found. Available: ${Object.keys(context.workfile.symbols).join(", ")}`);
    }

    return ok(node);
}

// --- Formatters ---

export function format_property_type(t: Property["_t"]): string {
    // Every kind, by the `type:` a schema writes for it: a new kind fails to compile here.
    const map: Record<Property["_t"], string> = {
        "NumberProperty": "number",
        "StringProperty": "string",
        "BooleanProperty": "boolean",
        "EnumProperty": "enum",
        "IncludeProperty": "include",
        "UnionProperty": "union",
        "ArrayProperty": "array",
        "PlatformOpsProperty": "platform_ops",
        "PlatformExtraProperty": "platform_extra",
        "DriverInitParameterProperty": "driver_init_param",
        "DriverOpsProperty": "driver_ops",
        "RawProperty": "raw",
    };
    return map[t];
}

/** A column as wide as its widest entry (or its heading), plus a gap. */
export function column_width(heading: string, entries: string[]): number {
    return Math.max(heading.length, ...entries.map(entry => entry.length)) + 2;
}

export function format_property_value(property: Property): string {
    if (property.value === undefined) { return "-"; }

    // A set union renders as `member = value`; `typeof null === "object"` in JS, so
    // the null check is what makes this a safe Object.entries target.
    if (property._t === "UnionProperty" && typeof property.value === "object" && property.value !== null) {
        const entry = Object.entries(property.value)[0];
        if (entry) {
            return `${entry[0]} = ${entry[1]}`;
        }
    }

    return String(property.value);
}

export function format_node_list(minimal: MinimalWorkfile, header?: string): string {
    const entries = Object.entries(minimal.symbols);

    if (entries.length === 0) {
        return "No nodes defined.";
    }

    let out = header ? `${header}\n\n` : "";
    const width = Math.max(...entries.map(([name]) => name.length)) + 2;
    const type_width = Math.max(...entries.map(([, node]) => node.$compatible.length)) + 2;
    for (const [name, node] of entries) {
        const marked = node["$auto"];
        const auto = Array.isArray(marked) ? marked.length : 0;
        const from_bootstrap = auto === 0 ? "" : `${String(auto)} value${auto === 1 ? "" : "s"} from bootstrap`;
        out += `  ${name.padEnd(width)}${node.$compatible.padEnd(type_width)}${from_bootstrap}`.trimEnd() + "\n";
    }

    return out;
}

export function format_property_list(node_name: string, properties: Property[]): string {
    let out = `${node_name} properties:\n\n`;
    const name_width = column_width("Property", properties.map(p => p.name));
    const type_width = column_width("Type", properties.map(p => format_property_type(p._t)));
    out += `  ${"Property".padEnd(name_width)}${"Type".padEnd(type_width)}${"Value"}\n`;
    out += `  ${"─".repeat(name_width + type_width + 18)}\n`;

    for (const p of properties) {
        const type = format_property_type(p._t);
        const value = format_property_value(p);
        out += `  ${p.name.padEnd(name_width)}${type.padEnd(type_width)}${value}\n`;
    }

    return out;
}

/** Who holds a property's value, for a person: bootstrap, the user, or the user's "nothing". */
export function property_owner(property: Property): string | undefined {
    if (property.cleared === true) {
        return "you (cleared: left empty, bootstrap will not fill it)";
    }
    if (property.value === undefined) {
        return undefined;
    }
    return property.auto === true
        ? "bootstrap (follows the rules until you change it)"
        : "you";
}

export function format_property_details(property: Property, suggestions: PropertySuggestions, program: string): string {
    let out = `${property.name}\n\n`;

    out += `  ${"Type:".padEnd(15)}${format_property_type(property._t)}\n`;
    out += `  ${"Required:".padEnd(15)}${property.required ? "yes" : "no"}\n`;
    out += `  ${"Value:".padEnd(15)}${format_property_value(property) || "(not set)"}\n`;
    const owner = property_owner(property);
    if (owner !== undefined) {
        out += `  ${"Set by:".padEnd(15)}${owner}\n`;
    }

    if ("default" in property && property.default !== undefined) {
        out += `  ${"Default:".padEnd(15)}${property.default}\n`;
    }

    if (property.description) {
        // A description can run several paragraphs (an override adds its own under the
        // schema's), so continuation lines line up under the first, blank lines kept bare.
        const indent = " ".repeat(2 + 15);
        const description = property.description
            .split("\n")
            .map((line, index) => (index === 0 || line === "" ? line : `${indent}${line}`))
            .join("\n");
        out += `  ${"Description:".padEnd(15)}${description}\n`;
    }

    switch (property._t) {
        case "NumberProperty": {
            if (property.minimum !== undefined || property.maximum !== undefined) {
                out += "\n  Constraints:\n";
                if (property.minimum !== undefined) { out += `    ${"minimum".padEnd(12)}${property.minimum}\n`; }
                if (property.maximum !== undefined) { out += `    ${"maximum".padEnd(12)}${property.maximum}\n`; }
            }
            break;
        }

        case "EnumProperty": {
            out += "\n  Options:\n";
            for (const value of property.values) {
                const current = property.value === value;
                const marker = current ? "●" : "○";
                const suffix = current ? "  (current)" : "";
                out += `    ${marker} ${value}${suffix}\n`;
            }
            break;
        }

        case "UnionProperty": {
            out += "\n  Members:\n";
            const selectedMember = property.value ? Object.keys(property.value)[0] : undefined;
            for (const member of property.members) {
                const selected = member.name === selectedMember;
                const marker = selected ? "●" : "○";
                const suffix = selected ? "  (selected)" : "";
                out += `    ${marker} ${member.name.padEnd(12)}${member.include}${suffix}\n`;
            }
            break;
        }

        case "BooleanProperty": {
            out += "\n  Options:\n";
            out += `    ${property.value === true ? "●" : "○"} true${property.value === true ? "  (current)" : ""}\n`;
            out += `    ${property.value === false ? "●" : "○"} false${property.value === false ? "  (current)" : ""}\n`;
            break;
        }

        case "ArrayProperty": {
            out += `  ${"Max size:".padEnd(15)}${property.size}\n`;
            out += "\n  Format: comma-separated values\n";
            out += `    ${program} update <node> ${property.name} value1,value2,value3\n`;
            break;
        }

        case "RawProperty": {
            // Raw values are emitted to the generated code byte-for-byte, so the
            // user must type the exact C token. String literals need quotes that
            // survive the shell (which strips bare ""), hence the escaping hint.
            out += "\n  Format: written to generated code verbatim (exactly as typed)\n";
            out += `    ${program} update <node> ${property.name} &my_handle       -> &my_handle\n`;
            out += `    ${program} update <node> ${property.name} '\"some text\"'    -> \"some text\"\n`;
            out += "  To emit a C string literal, keep the quotes: use '\"...\"' or \\\"...\\\"\n";
            break;
        }
    }

    // Enums (and booleans) already list every possible value in their Options
    // block above, so repeating them under Suggestions is just noise.
    const options_shown = property._t === "EnumProperty" || property._t === "BooleanProperty";
    if (!options_shown && suggestions.values && suggestions.values.length > 0) {
        out += "\n  Suggestions:\n";
        for (const value of suggestions.values) {
            out += `    • ${value}\n`;
        }
    }

    if (suggestions.types && suggestions.types.length > 0) {
        out += "\n  Can create:\n";
        for (const type of suggestions.types) {
            out += `    + ${type}\n`;
        }
    }

    return out;
}
