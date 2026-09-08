import path from "node:path";
import fs from "node:fs";
import type { Result} from "../ruleset_parser/result";
import { ok, error } from "../ruleset_parser/result";
import type {
    ArrayProperty,
    EnumProperty,
    IncludeProperty,
    PlatformExtraProperty,
    PlatformOpsProperty,
    Ruleset,
    RulesetPlatformOps,
    RulesetStruct,
    RulesetType,
    UnionProperty
} from "../ruleset_parser/types";
import { provided_id } from "../ruleset_parser/types";
import { scan_platforms } from "./platform_scanner";
import type { PlatformManifest, PropertySuggestions } from "./types";
import { load_resolved_ruleset } from "../resolver/resolver";
import { get_schemas_path } from "../settings/settings";
import { collect_child_overrides, create_connections_graph, rename_symbol_references } from "../validator/connection_graph";
import { apply_overrides } from "../validator/override_resolver";
import type { AvailableStructs, MinimalWorkfile, Workfile } from "./types";
import { is_minimal_workfile } from "./types";
import { parse_ruleset } from "../ruleset_parser/ruleset_parser";

// --- Workfile Creation ---

export function create_workfile(platform?: string): Result<Workfile> {
    const workfile: Workfile = {
        platform: platform,
        platform_ops: {},
        exposed_ops: {},
        symbols: {}
    };

    if (!platform) {
        return ok(workfile);
    }

    const schemas_path = get_schemas_path();
    if (!schemas_path.ok) {
        return schemas_path;
    }

    const platforms_result = scan_platforms(path.join(schemas_path.value, "platforms"));
    if (!platforms_result.ok) {
        return platforms_result;
    }

    const manifest = platforms_result.value[platform];
    if (!manifest) {
        return error(`Platform '${platform}' not found`, "platform");
    }

    workfile.platform_vendor = manifest.vendor;

    const load_result = load_platform(workfile, manifest);
    return load_result; // Error or not, we return this anyway
}

export function all_ops(workfile: Workfile): Record<string, Ruleset> {
    return { ...workfile.platform_ops, ...workfile.exposed_ops };
}

export function recompute_exposed_ops(workfile: Workfile): Result<void> {
    const rebuilt: Record<string, Ruleset> = {};

    for (const symbol of Object.values(workfile.symbols)) {
        if (symbol._t !== "RulesetStruct" || !symbol.$exposes) {
            continue;
        }

        for (const ops_path of symbol.$exposes) {
            const loaded = load_resolved_ruleset(ops_path);
            if (!loaded.ok) {
                return loaded;
            }

            const ops = loaded.value;
            if (ops._t !== "RulesetPlatformOps") {
                return error(`$exposes target is not platform_ops: ${ops_path}`, ops_path);
            }

            // Naming collision. 2 different C globals sharing the same identifier
            if (ops.$symbol in workfile.platform_ops) {
                return error(`Exposed ops '${ops.$symbol}' collides with a platform op with the same name`, ops.$symbol);
            }

            // Same guard between two exposed ops: same file exposed by multiple
            // structs dedupes silently, but two different files sharing a $symbol
            // is a real collision.
            const existing = rebuilt[ops.$symbol];
            if (existing && existing.$id !== ops.$id) {
                return error(`Exposed ops '${ops.$symbol}' collides with another exposed op with the same name`, ops.$symbol);
            }

            rebuilt[ops.$symbol] = ops;
        }
    }

    workfile.exposed_ops = rebuilt;
    return ok();
}

// --- Platform Ops (locked, from manifest) ---

export function add_platform_ops(workfile: Workfile, name: string, ruleset: RulesetPlatformOps): Result<void> {
    if (name in workfile.platform_ops) {
        return error(`Platform ops '${name}' already exists`, "name");
    }
    workfile.platform_ops[name] = ruleset;
    return ok();
}

export function get_platform_ops(workfile: Workfile, name: string): Result<RulesetPlatformOps> {
    const ops = workfile.platform_ops[name];
    if (!ops) {
        return error(`Platform ops '${name}' not found`, "name");
    }
    return ok(ops as RulesetPlatformOps);
}

export function list_platform_ops(workfile: Workfile): string[] {
    return Object.keys(all_ops(workfile));
}

export function clear_platform_ops(workfile: Workfile): void {
    workfile.platform_ops = {};
}

// --- Symbol CRUD (user-created) ---

const C_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate that a name is a valid C identifier.
 * `label` is used in the error message (e.g. "Symbol", "Descriptor name").
 */
export function validate_c_name(name: string, label = "Symbol", field?: string): Result<void> {
    if (!C_NAME_REGEX.test(name)) {
        return error(`${label} '${name}' is not a valid C name`, field);
    }
    return ok();
}

export function add_symbol(workfile: Workfile, name: string, ruleset: Ruleset): Result<Workfile> {
    const valid_name = validate_c_name(name);
    if (!valid_name.ok) {
        return valid_name;
    }
    if (name in workfile.symbols) {
        return error(`Symbol '${name}' already exists`, "name");
    }
    if (name in workfile.platform_ops) {
        return error(`Symbol '${name}' conflicts with platform ops`, "name");
    }
    workfile.symbols[name] = ruleset;
    const recompute = recompute_exposed_ops(workfile);
    if (!recompute.ok) {
        delete workfile.symbols[name]; // roll back the add on failure
        return recompute;
    }
    return ok(workfile);
}

export function get_symbol(workfile: Workfile, name: string): Result<Ruleset> {
    if (!(name in workfile.symbols)) {
        return error(`Symbol '${name}' does not exist`, "name");
    }
    return ok(workfile.symbols[name]);
}

export function remove_symbol(workfile: Workfile, name: string): Result<void> {
    if (!(name in workfile.symbols)) {
        return error(`Symbol '${name}' not found`, "name");
    }
    delete workfile.symbols[name];
    return recompute_exposed_ops(workfile);
}

export function rename_symbol(workfile: Workfile, old_name: string, new_name: string): Result<Workfile> {
    const valid_name = validate_c_name(new_name);
    if (!valid_name.ok) {
        return valid_name;
    }
    const symbol = workfile.symbols[old_name];
    if (!symbol) {
        return error(`Symbol '${old_name}' not found`, "old_name");
    }
    if (new_name in workfile.symbols) {
        return error(`Symbol '${new_name}' already exists`, "new_name");
    }
    if (new_name in workfile.platform_ops) {
        return error(`Symbol '${new_name}' conflicts with platform ops`, "new_name");
    }
    workfile.symbols[new_name] = symbol;
    delete workfile.symbols[old_name];

    // Rewrite references to the old name held in other symbols' property values.
    rename_symbol_references(workfile, old_name, new_name);

    // recompute might not be needed here, but more uniform
    const recompute = recompute_exposed_ops(workfile);
    if (!recompute.ok) {
        return recompute;
    }

    return ok(workfile);
}

export function list_symbols(workfile: Workfile): string[] {
    return Object.keys(workfile.symbols);
}

// --- Lookup (checks both platform_ops and symbols) ---

export function find_any(workfile: Workfile, name: string): Ruleset | undefined {
    return all_ops(workfile)[name] ?? workfile.symbols[name];
}

// --- Property Values ---

export function set_value(workfile: Workfile, symbol_name: string, property_name: string, value?: unknown): Result<void> {
    const ruleset = workfile.symbols[symbol_name];
    if (!ruleset) {
        return error(`Symbol '${symbol_name}' not found`, "symbol_name");
    }
    // Descriptor nodes also carry properties (their `$init_param` include, plus their own members),
    // so their $init_param reference is settable through the same path.
    if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor") {
        return error(`Symbol '${symbol_name}' is not a struct or device`, "symbol_name");
    }

    const property = ruleset.properties.find(p => p.name === property_name);
    if (!property) {
        return error(`Property '${property_name}' not found in '${symbol_name}'`, "property_name");
    }

    // A readonly field is filled in by generated code — an init function for a descriptor
    // member, the target template for a derived struct field — so a user value would either
    // be overwritten or contradict what the code does.
    if (property.readonly === true) {
        return error(`Property '${property_name}' of '${symbol_name}' is filled in by generated code and cannot be assigned`, "property_name");
    }

    property.value = value;
    return ok();
}

export function get_value(workfile: Workfile, symbol_name: string, property_name: string): Result<unknown> {
    const ruleset = workfile.symbols[symbol_name];
    if (!ruleset || (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor")) {
        return error(`Symbol '${symbol_name}' is not a struct or device`, "symbol_name");
    }

    const property = ruleset.properties.find(p => p.name === property_name);
    if (property === undefined) {
        return error(`Property '${property_name}' not found`, "property_name");
    }
    return ok(property.value);
}

// --- References ---

// What a property value points at. A value is either a whole node ("accel_iio") or one
// readonly member of one ("accel_iio.iio_dev"), and both need the same two answers: the
// $id to type-check against, and the C expression that reaches it.
export interface ResolvedReference {
    // The type an including property must match. A node's own $id, or — for a member — the
    // $id that member's own include names.
    $id: string,
    // The C expression naming it, with no `&`: the caller adds that from its own pointer-ness.
    expr: string,
    // True when reaching it goes through a descriptor, so the expression is only valid after
    // that descriptor's init has run. Such fields are patched at runtime, not initialized.
    runtime: boolean,
    // False when the thing reached is a value rather than a pointer, so a consumer declaring
    // a pointer field needs to take its address.
    pointer: boolean,
}

// One level deep, matching `runtime_assignments.field_path`, which already caps at
// `property.name.member`.
export function resolve_reference(workfile: Workfile, value: string): ResolvedReference | undefined {
    const dot = value.indexOf(".");
    if (dot === -1) {
        const node = find_any(workfile, value);
        if (!node) {
            return undefined;
        }

        // An extern is the library's own global, so the C expression is the symbol it
        // names, not the workfile node name the user chose for it. An array symbol already
        // decays to a pointer, so it reports itself as one and no `&` is added.
        if (node._t === "RulesetExtern") {
            return {
                $id: node.$provides,
                expr: node.$symbol,
                runtime: false,
                pointer: node.$array === true,
            };
        }

        const runtime = node._t === "RulesetDescriptor";
        return {
            $id: node.$id,
            // `struct descriptors` holds descriptors as pointers, so a descriptor node is
            // already a pointer while a plain struct is a value.
            expr: runtime ? `desc.${value}` : value,
            runtime: runtime,
            pointer: runtime,
        };
    }

    const owner_name = value.slice(0, dot);
    const member_name = value.slice(dot + 1);
    if (member_name.includes(".")) {
        return undefined;
    }

    const owner = workfile.symbols[owner_name];
    if (!owner || (owner._t !== "RulesetStruct" && owner._t !== "RulesetDescriptor")) {
        return undefined;
    }

    const member = owner.properties.find(p => p.name === member_name);
    // Only a readonly member is referenceable: a settable one has no value until the user
    // gives it one, so pointing at it would name nothing.
    if (member?.readonly !== true) {
        return undefined;
    }

    // The member has to name a type of its own for the reference to be type-checked, which
    // means a concrete `include`. A raw or numeric member describes no type to match.
    if (member._t !== "IncludeProperty" || member.include === undefined) {
        return undefined;
    }

    const owner_is_descriptor = owner._t === "RulesetDescriptor";
    return {
        $id: member.include,
        expr: owner_is_descriptor ? `desc.${owner_name}->${member_name}` : `${owner_name}.${member_name}`,
        runtime: owner_is_descriptor,
        pointer: member.pointer === true,
    };
}

// --- Suggestions ---

export function suggest_for_include(workfile: Workfile, include: IncludeProperty): Result<PropertySuggestions> {
    if (include.include === undefined) {
        return suggest_for_include_type(workfile, include.include_type);
    }

    const include_path = include.include;
    const resolved = load_resolved_ruleset(include_path);
    if (resolved.ok && resolved.value._t === "RulesetEnum") {
        return ok({
            values: resolved.value.values.map(v => typeof v.name === "number" ? v.name.toString() : v.name),
        });
    }

    const values: string[] = [];

    // add the already declared symbols
    for (const [name, ruleset] of Object.entries(workfile.platform_ops)) {
        if (ruleset.$id === include_path) {
            values.push(name);
        }
    }
    for (const [name, ruleset] of Object.entries(workfile.symbols)) {
        // `provided_id`, not `$id`: an extern matches on the type of the global it names.
        if (provided_id(ruleset) === include_path) {
            values.push(name);
        }
    }

    // A readonly member of another node is just as referenceable as a whole node, so offer
    // those too. This is how a driver's iio wrapper hands over its `iio_dev`.
    values.push(...member_references(workfile, include_path));

    return ok({
        values: values.length === 0 ? undefined : values,
        types: [include_path],
    });
}

// Every `node.member` in the workfile whose member names `include_path`.
function member_references(workfile: Workfile, include_path: string): string[] {
    const values: string[] = [];

    for (const [name, ruleset] of Object.entries(workfile.symbols)) {
        if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor") {
            continue;
        }

        for (const property of ruleset.properties) {
            if (property.readonly !== true || property._t !== "IncludeProperty") {
                continue;
            }
            if (property.include === include_path) {
                values.push(`${name}.${property.name}`);
            }
        }
    }

    return values;
}

// Same shape as above, matching on the target's kind instead of its $id. No `types`:
// any ruleset of that type qualifies, so there is no one thing to offer creating —
// `list_available_structs` is the call for browsing those.
function suggest_for_include_type(workfile: Workfile, include_type: RulesetType): Result<PropertySuggestions> {
    const values: string[] = [];

    for (const [name, ruleset] of Object.entries(workfile.platform_ops)) {
        if (ruleset.$type === include_type) {
            values.push(name);
        }
    }
    for (const [name, ruleset] of Object.entries(workfile.symbols)) {
        if (ruleset.$type === include_type) {
            values.push(name);
        }
    }

    return ok({
        values: values.length === 0 ? undefined : values,
    });
}

export function suggest_for_union(workfile: Workfile, union: UnionProperty, member_name?: string): Result<PropertySuggestions> {
    if (member_name === undefined) {
        // Suggest the member names (one must be selected for further suggestions)
        return ok({ values: union.members.map(p => p.name)});
    }

    const member = union.members.find(m => m.name === member_name);
    if (!member) {
        return error(`Unknown union member '${member_name}'`, member_name);
    }
    return suggest_for_include(workfile, member);
}

export function suggest_for_array(workfile: Workfile, array: ArrayProperty): Result<PropertySuggestions> {
    switch (array.element._t) {
        case "IncludeProperty": {
            return suggest_for_include(workfile, array.element);
        }
        case "EnumProperty": {
            return suggest_for_enum(array.element);
        }
        case "BooleanProperty": {
            return ok({ values: ["true", "false"] });
        }
        case "NumberProperty": {
            // Numbers have no discrete set of suggestions.
            return ok({});
        }
    }
}

export function suggest_for_enum(property: EnumProperty): Result<PropertySuggestions> {
    return ok({ values: property.values.map(p => typeof p === "number" ? p.toString() : p)});
}

export function suggest_platform_ops(workfile: Workfile, property: PlatformOpsProperty, parent_struct: RulesetStruct): Result<PropertySuggestions> {
    const suggestions: string[] = [];

    for (const [name, ops] of Object.entries(all_ops(workfile))) {
        if (ops._t !== "RulesetPlatformOps") {
            continue;
        }

        // When an allowed list is set (from $override), only suggest from that list
        if (property.allowed) {
            if (property.allowed.includes(ops.$id)) {
                suggestions.push(name);
            }
        } else if (ops.$capability === parent_struct.$capability) {
            // No override restriction, fall back to capability matching
            suggestions.push(name);
        }
    }

    return ok({ values: suggestions });
}

export function suggest_platform_extra(workfile: Workfile, property: PlatformExtraProperty, parent_struct: RulesetStruct): Result<PropertySuggestions> {
    // Add possible schemas that would fit here
    const available = list_available_structs(workfile);
    if (!available.ok) {
        // This should not happen, getting here without being able to resolve the structs is odd
        return ok({});
    }

    const values: string[] = [];
    const types: string[] = [];

    // Add already created symbols
    for (const [name, symbol] of Object.entries(workfile.symbols)) {
        if (symbol._t !== "RulesetStruct") {
            continue;
        }

        if (symbol === parent_struct) {
            continue; // skip self
        }

        // When an allowed list is set (from $override), only suggest from that list
        if (property.allowed) {
            if (property.allowed.includes(symbol.$id)) {
                values.push(name);
            }
        } else if (available.value.platform.includes(symbol.$id) && symbol.$capability === parent_struct.$capability) {
            // No override restriction, fall back to capability matching
            values.push(name);
        }
    }

    for (const schema_path of available.value.platform) {
        const ruleset = load_resolved_ruleset(schema_path);
        if (!ruleset.ok || ruleset.value._t !== "RulesetStruct") {
            continue;
        }

        // When an allowed list is set (from $override), only suggest from that list
        if (property.allowed) {
            if (property.allowed.includes(ruleset.value.$id)) {
                types.push(schema_path);
            }
        } else if (ruleset.value.$capability === parent_struct.$capability) {
            // No override restriction, fall back to capability matching
            types.push(schema_path);
        }
    }

    return ok({
        values: values.length > 0 ? values : undefined,
        types: types.length > 0 ? types : undefined,
    });
}

export function suggest_for_property(workfile: Workfile, symbol_name: string, property_name: string, union_member?: string): Result<PropertySuggestions> {
    const symbol = workfile.symbols[symbol_name];
    if (!symbol) {
        return error(`Could not find symbol with name: "${symbol_name}" in [${Object.keys(workfile.symbols).join(", ")}]`, "");
    }

    if (symbol._t !== "RulesetStruct" && symbol._t !== "RulesetDescriptor") {
        return error(`Expected type RulesetStruct or RulesetDescriptor, got "${symbol._t}"`, "");
    }

    const property = symbol.properties.find(p => p.name === property_name);
    if (!property) {
        return error(`Could not find property "${property_name}" in [${symbol.properties.map(p => p.name).join(", ")}]`, symbol_name);
    }

    switch (property._t) {
        case "NumberProperty": {
            return ok({});
        }
        case "BooleanProperty": {
            return ok({ values: ["true", "false"]});
        }
        case "StringProperty": {
            return ok({});
        }
        case "IncludeProperty": {
            return suggest_for_include(workfile, property);
        }
        case "EnumProperty": {
            return suggest_for_enum(property);
        }
        case "UnionProperty": {
            return suggest_for_union(workfile, property, union_member);
        }
        case "ArrayProperty": {
            return suggest_for_array(workfile, property);
        }
        case "PlatformOpsProperty": {
            // Only structs carry platform_ops; a descriptor node never reaches here.
            if (symbol._t !== "RulesetStruct") {
                return error(`Property '${property_name}' is not valid on a descriptor node`, symbol_name);
            }
            const graph = create_connections_graph(workfile);
            const child_overrides = collect_child_overrides(symbol_name, workfile, graph);
            const { effective } = apply_overrides(property, child_overrides, symbol_name, workfile);
            return suggest_platform_ops(workfile, effective as PlatformOpsProperty, symbol);
        }
        case "PlatformExtraProperty": {
            // Only structs carry platform_extra; a descriptor node never reaches here.
            if (symbol._t !== "RulesetStruct") {
                return error(`Property '${property_name}' is not valid on a descriptor node`, symbol_name);
            }
            const graph = create_connections_graph(workfile);
            const child_overrides = collect_child_overrides(symbol_name, workfile, graph);
            const { effective } = apply_overrides(property, child_overrides, symbol_name, workfile);
            return suggest_platform_extra(workfile, effective as PlatformExtraProperty, symbol);
        }
        case "RawProperty": {
            return ok({});
        }
        default: {
            return error("unknown type");
        }
    }
}

export function list_available_structs(workfile: Workfile): Result<AvailableStructs> {
    const schema_path = get_schemas_path();
    if (!schema_path.ok) {
        return schema_path;
    }

    const devices = scan_yaml_files(path.join(schema_path.value, "devices"));
    if (!devices.ok) {
        return error(`Path ${path.join(schema_path.value, "devices")} not found`);
    }

    const noos = scan_yaml_files(path.join(schema_path.value, "no-os"));
    if (!noos.ok) {
        return error(`Path ${path.join(schema_path.value, "noos")} not found`);
    }

    // Get platform structs from manifest if platform is set
    let platform_structs: string[] = [];
    if (workfile.platform) {
        const platforms_result = scan_platforms(path.join(schema_path.value, "platforms"));
        if (platforms_result.ok) {
            const manifest = platforms_result.value[workfile.platform];
            if (manifest) {
                platform_structs = manifest.structs;
            }
        }
    }

    // Only instantiable rulesets (structs + descriptors) are offered; enums and other
    // non-instantiable types are filtered out.
    return ok({
        devices: devices.value.filter(item => is_instantiable(path.join(schema_path.value, item))),
        noos: noos.value.filter(item => is_instantiable(path.join(schema_path.value, item))),
        platform: platform_structs.filter(item => is_instantiable(path.join(schema_path.value, item)))
    });
}

function is_instantiable(path: string) {
    if (!fs.existsSync(path)) {
        return false;
    }
    const contents = fs.readFileSync(path, "utf8");
    const ruleset = parse_ruleset(contents);
    if (!ruleset.ok) {
        return false;
    }
    // An extern is instantiable even though it configures nothing: adding it to the
    // workfile is what makes its symbol referenceable and pulls in its $config.
    return ruleset.value._t === "RulesetStruct"
        || ruleset.value._t === "RulesetDescriptor"
        || ruleset.value._t === "RulesetExtern";
};

function scan_yaml_files(directory: string): Result<string[]> {
    const schema_path = get_schemas_path();
    if (!schema_path.ok) {
        return schema_path;
    }

    const results: string[] = [];
    const scan = (current: string) => {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const full_path = path.join(current, entry.name);
            if (entry.isDirectory()) {
                scan(full_path);
            } else if (entry.name.endsWith(".yaml")) {
                results.push(path.relative(schema_path.value, full_path));
            }
        }
    };

    scan(directory);
    return ok(results);
}

// --- Platform Loading ---

export function load_platform(workfile: Workfile, manifest: PlatformManifest): Result<Workfile> {
    clear_platform_ops(workfile);

    for (const ops_path of manifest.ops) {
        const ruleset_result = load_resolved_ruleset(ops_path);
        if (!ruleset_result.ok) {
            return ruleset_result;
        }

        const ruleset = ruleset_result.value;
        if (ruleset._t !== "RulesetPlatformOps") {
            return error(`Expected platform_ops ruleset, got ${ruleset._t}: ${ops_path}`, ops_path);
        }

        const add_result = add_platform_ops(workfile, ruleset.$symbol, ruleset);
        if (!add_result.ok) {
            return add_result;
        }
    }

    workfile.platform = manifest.name;
    workfile.platform_vendor = manifest.vendor;

    return ok(workfile);
}

// --- Transformations ---

export function export_minimal(workfile: Workfile): Result<MinimalWorkfile> {
    if (!workfile.platform) {
        return error("No platform loaded", "platform");
    }

    const symbols: MinimalWorkfile["symbols"] = {};

    for (const [name, ruleset] of Object.entries(workfile.symbols)) {
        // Every user-created node kind. Platform ops are excluded because the platform
        // manifest reloads them, not the workfile.
        if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor" && ruleset._t !== "RulesetExtern") {
            continue;
        }

        const node: MinimalWorkfile["symbols"][string] = {
            $compatible: ruleset.$id,
        };

        // An extern has no properties, so `$compatible` alone round-trips it.
        if (ruleset._t !== "RulesetExtern") {
            for (const property of ruleset.properties) {
                if (property.value !== undefined) {
                    node[property.name] = property.value;
                }
            }
        }

        symbols[name] = node;
    }

    return ok({
        platform: workfile.platform,
        // Only written once a board has been chosen, so workfiles that predate
        // boards (and those left to resolve theirs from the chip) stay as they are.
        ...(workfile.board === undefined ? {} : { board: workfile.board }),
        symbols: symbols
    });
}

export function import_minimal(minimal: MinimalWorkfile): Result<Workfile> {
    const workfile_result = create_workfile(minimal.platform);
    if (!workfile_result.ok) {
        return workfile_result;
    }

    const workfile = workfile_result.value;
    workfile.board = minimal.board;

    for (const [name, node] of Object.entries(minimal.symbols)) {
        const ruleset_result = load_resolved_ruleset(node.$compatible);
        if (!ruleset_result.ok) {
            return ruleset_result;
        }

        const ruleset = ruleset_result.value;

        const add_result = add_symbol(workfile, name, ruleset);
        if (!add_result.ok) {
            return add_result;
        }

        for (const [property_name, value] of Object.entries(node)) {
            if (property_name === "$compatible") {
                continue;
            }
            const set_result = set_value(workfile, name, property_name, value);
            if (!set_result.ok) {
                // A stored value the current schemas reject is a stale workfile, not a bad
                // command, so say which key to remove rather than only why it was refused.
                return error(
                    `Workfile symbol '${name}' cannot be loaded: ${set_result.error.message}. Remove '${property_name}' from it.`,
                    set_result.error.path
                );
            }
        }
    }

    return ok(workfile);
}

export function load_minimal_workfile(file_path: string): Result<MinimalWorkfile> {
    if (!fs.existsSync(file_path)) {
        return error(`Workfile not found: ${file_path}`, file_path);
    }

    let content: string;
    try {
        content = fs.readFileSync(file_path, "utf8");
    } catch {
        return error(`Failed to read workfile: ${file_path}`, file_path);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return error(`Failed to parse workfile as JSON: ${file_path}`, file_path);
    }

    if (!is_minimal_workfile(parsed)) {
        return error(`Invalid workfile format: ${file_path}`, file_path);
    }

    return ok(parsed);
}

// --- Persistence ---

export function clone_workfile(workfile: Workfile): Workfile {
    return structuredClone(workfile);
}
