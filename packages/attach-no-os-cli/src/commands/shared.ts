import fs from "node:fs";
import path from "node:path";
import type { ApplicationContext } from "@stricli/core";
import {
    export_minimal,
    get_effective_setting_value,
    get_schemas_path,
    get_workfile_path,
    scan_platforms,
    PlatformSpecs,
    import_minimal,
    load_minimal_workfile,
    MinimalWorkfile,
    Property,
    PropertySuggestions,
    Result,
    Workfile,
    ok,
    error,
    Ruleset,
    RulesetStruct,
    RulesetDescriptor
} from "attach-no-os-lib";
import { RESERVED_PREFIX } from "../protocol/convert";
import { common_error } from "../protocol/responses";

// --- Types ---

/**
 * Context stricli passes to every command as `this`.
 *
 * There is nothing session-scoped left to carry: attach-meta forwards no global flags, so
 * the workfile a command acts on comes from the `workfile` setting rather than from a
 * `--workfile` flag threaded through here.
 */
export type AttachContext = ApplicationContext;

export type WorkfileContext = {
    path: string;
    minimal: MinimalWorkfile;
    workfile: Workfile;
};

export type OutputFlags = {
    json?: boolean;
};

// --- Schema Platforms ---

/**
 * Every platform the schema tree describes, keyed by platform id.
 *
 * Shared because board resolution needs the manifests rather than a flattened list:
 * `platform_for_board` decides whether a board's TARGET or its PLATFORM names a schema
 * directory by looking the id up in here.
 */
export function get_platform_specs(): Result<PlatformSpecs> {
    const schemas_path = get_schemas_path();
    if (!schemas_path.ok) {
        return schemas_path;
    }

    return scan_platforms(path.join(schemas_path.value, "platforms"));
}

// --- Workfile Loading ---

export function load_context(): Result<WorkfileContext> {
    const resolved = get_workfile_path();
    if (!resolved.ok) {
        return resolved;
    }

    const path = resolved.value;
    if (!fs.existsSync(path)) {
        return error(`No workfile at '${path}'. Create one with 'attach-noos create-workfile', or point the 'workfile' setting elsewhere.`);
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
 * attach-meta never puts the root in a path — an empty path *is* the root — so this only
 * has to be recognisable, and the workfile's own name is the most recognisable thing there
 * is. `read` needs it because a `Node` must have a key; `add` needs it to explain that the
 * root is the only place a node can go.
 */
export function root_key(context: WorkfileContext): string {
    return path.basename(context.path, path.extname(context.path));
}

// --- Project Location ---

/**
 * Name of the project `generate` writes.
 *
 * attach-meta calls `generate` with no arguments, so the name comes from the
 * `project_name` setting — and when that is unset, from the workfile's own directory,
 * which is the name of the thing being built in every layout we have seen.
 */
export function get_project_name(context: WorkfileContext): Result<string> {
    const configured = get_effective_setting_value("project_name");
    if (!configured.ok) {
        return configured;
    }

    return ok(configured.value || path.basename(path.dirname(context.path)));
}

/**
 * Directory `build` and `deploy` act on.
 *
 * `project_path` names it outright. Otherwise it is where `generate` would have put the
 * project — `<output_path>/<project_name>` — which keeps generate/build/deploy pointed at
 * the same place from one setting. With neither, the current directory: that is the
 * "I am already in the project" case.
 */
export function get_project_path(): Result<string> {
    const configured = get_effective_setting_value("project_path");
    if (!configured.ok) {
        return configured;
    }

    if (configured.value) {
        return ok(path.resolve(process.cwd(), configured.value));
    }

    const name = get_effective_setting_value("project_name");
    if (!name.ok) {
        return name;
    }

    if (!name.value) {
        return ok(process.cwd());
    }

    const output_path = get_effective_setting_value("output_path");
    if (!output_path.ok) {
        return output_path;
    }

    return ok(path.resolve(process.cwd(), output_path.value ?? ".", name.value));
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

// --- Output Helpers ---

export function output(flags: OutputFlags, text: string, json: unknown): void {
    if (flags.json) {
        console.log(JSON.stringify(json, undefined, 2));
    } else {
        console.log(text);
    }
}

/**
 * Report a failed operation.
 *
 * The exit code is deliberately asymmetric. A shell needs a non-zero status to know the
 * command failed, but attach-meta treats a non-zero exit as a *transport* error — the
 * subtool is broken — and never looks at the JSON it printed. So under `--json` a failure
 * is a successful run that reports `ok: false`, and the exit code stays 0.
 *
 * `response` overrides the body for the two responses that have no `ok` field of their own
 * (see `read_failure` and `validation_failure`); `text` replaces what a human is shown when
 * the failure is worth more than one line.
 */
export type ErrorOutput = {
    response?: unknown;
    text?: string;
};

export function output_error(flags: OutputFlags, message: string, options: ErrorOutput = {}): void {
    if (!flags.json) {
        // stricli's run() does `exitCode ??= ...`, so setting it here survives.
        process.exitCode = 1;
    }

    output(flags, options.text ?? message, options.response ?? common_error(message));
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

// For commands that only need the node to exist - `attach-noos delete`,
// `attach-noos read <node>`. Any kind the user can create counts, including an
// extern, which is a name with nothing to set.
export function get_any_node(context: WorkfileContext, node_name: string): Result<Ruleset> {
    const node = context.workfile.symbols[node_name];
    if (!node) {
        return error(`Node '${node_name}' not found. Available: ${Object.keys(context.workfile.symbols).join(", ")}`);
    }

    return ok(node);
}

// --- Formatters ---

export function format_property_type(t: string): string {
    const map: Record<string, string> = {
        "NumberProperty": "number",
        "StringProperty": "string",
        "BooleanProperty": "boolean",
        "EnumProperty": "enum",
        "IncludeProperty": "include",
        "UnionProperty": "union",
        "ArrayProperty": "array",
        "PlatformOpsProperty": "platform_ops",
        "PlatformExtraProperty": "platform_extra",
        "RawProperty": "raw",
    };
    return map[t] ?? t;
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
    for (const [name, node] of entries) {
        out += `  ${name.padEnd(18)}${node.$compatible}\n`;
    }

    return out;
}

export function format_property_list(node_name: string, properties: Property[]): string {
    let out = `${node_name} properties:\n\n`;
    out += `  ${"Property".padEnd(20)}${"Type".padEnd(14)}${"Value"}\n`;
    out += `  ${"─".repeat(50)}\n`;

    for (const p of properties) {
        const type = format_property_type(p._t);
        const value = format_property_value(p);
        out += `  ${p.name.padEnd(20)}${type.padEnd(14)}${value}\n`;
    }

    return out;
}

export function format_property_details(property: Property, suggestions: PropertySuggestions): string {
    let out = `${property.name}\n\n`;

    out += `  ${"Type:".padEnd(15)}${format_property_type(property._t)}\n`;
    out += `  ${"Required:".padEnd(15)}${property.required ? "yes" : "no"}\n`;
    out += `  ${"Value:".padEnd(15)}${format_property_value(property) || "(not set)"}\n`;

    if ("default" in property && property.default !== undefined) {
        out += `  ${"Default:".padEnd(15)}${property.default}\n`;
    }

    if (property.description) {
        out += `  ${"Description:".padEnd(15)}${property.description}\n`;
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
            out += `    attach-noos update <node> ${property.name} value1,value2,value3\n`;
            break;
        }

        case "RawProperty": {
            // Raw values are emitted to the generated code byte-for-byte, so the
            // user must type the exact C token. String literals need quotes that
            // survive the shell (which strips bare ""), hence the escaping hint.
            out += "\n  Format: written to generated code verbatim (exactly as typed)\n";
            out += `    attach-noos update <node> ${property.name} &my_handle       -> &my_handle\n`;
            out += `    attach-noos update <node> ${property.name} '\"some text\"'    -> \"some text\"\n`;
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
