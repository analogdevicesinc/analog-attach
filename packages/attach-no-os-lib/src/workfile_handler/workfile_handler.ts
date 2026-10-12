import fs from "node:fs";
import type { Result} from "../ruleset_parser/result";
import { ok, error } from "../ruleset_parser/result";
import type {
    ArrayProperty,
    EnumProperty,
    IncludeProperty,
    NumberProperty,
    PlatformExtraProperty,
    PlatformOpsProperty,
    Property,
    Ruleset,
    RulesetPlatformOps,
    RulesetStruct,
    UnionProperty
} from "../ruleset_parser/types";
import { provided_id, RulesetType } from "../ruleset_parser/types";
import { format_number } from "../ruleset_parser/number_format";
import type { PropertySuggestions } from "./types";
import { load_resolved_ruleset, load_resolved_ruleset_for_board } from "../resolver/resolver";
import { all_symbols, is_platform_symbol } from "../registry/registry";
import { board_externs } from "../registry/bsp";
import { find_soc } from "../registry/platforms";
import { build_extern_index, hidden_candidates } from "../registry/hidden";
import type { ExternIndex, HiddenCandidate } from "../registry/hidden";
import { driver_init_parameter_candidates, driver_ops_candidates, rank_driver_candidates } from "../registry/drivers";
import { collect_child_overrides, create_connections_graph, rename_symbol_references } from "../validator/connection_graph";
import { apply_overrides } from "../validator/override_resolver";
import type { AvailableStructs, MinimalWorkfile, Workfile } from "./types";
import { is_minimal_workfile } from "./types";

// --- Workfile Creation ---

export function create_workfile(platform?: string): Result<Workfile> {
    const workfile: Workfile = {
        platform: platform,
        platform_ops: {},
        exposed_ops: {},
        symbols: {}
    };

    if (platform === undefined) {
        return ok(workfile);
    }

    // The chip has to be one a configured platform supports, or the workfile names a target
    // nothing can build: better to say so here than to fail later with an empty board list.
    const soc = find_soc(platform);
    if (!soc.ok) {
        return soc;
    }

    workfile.platform_vendor = soc.value.platform.vendor ?? soc.value.platform.name;

    // TODO(capi): the ops tables. A platform no longer ships a platform.yaml listing
    // ruleset files; it declares its interfaces in the `interfaces_file:` its module.yml
    // names, and ops reach a workfile through that and through each driver's own ops
    // extern. Until that lands a workfile carries the target and no ops.
    return ok(workfile);
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

            // No guard needed between two exposed ops: `$symbol` is a ruleset's identity
            // and the registry rejects two files claiming the same one, so the same
            // `$symbol` here is necessarily the same ruleset and dedupes silently.

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

/** The workfile node key listing the values bootstrap owns. */
const AUTO_KEY = "$auto";

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
    if (workfile.hidden !== undefined) {
        workfile.hidden = workfile.hidden.filter(hidden => hidden !== name);
    }
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

/** The property a value can be written to, or why it cannot be. */
function settable_property(workfile: Workfile, symbol_name: string, property_name: string): Result<Property> {
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

    return ok(property);
}

export function set_value(workfile: Workfile, symbol_name: string, property_name: string, value?: unknown): Result<void> {
    const property = settable_property(workfile, symbol_name, property_name);
    if (!property.ok) {
        return property;
    }

    // A written value is its writer's: the user's, unless bootstrap marks it its own right
    // after (mark_auto). That is what takes a value out of bootstrap's hands when the user
    // edits it. A value also replaces "set to nothing".
    property.value.value = value;
    delete property.value.auto;
    if (value !== undefined) {
        delete property.value.cleared;
    }
    return ok();
}

/**
 * Set a property to nothing on the user's behalf. It reads as unset everywhere, but it is the
 * user's - bootstrap does not fill it back in - until a value is written again.
 */
export function clear_value(workfile: Workfile, symbol_name: string, property_name: string): Result<void> {
    const property = settable_property(workfile, symbol_name, property_name);
    if (!property.ok) {
        return property;
    }

    delete property.value.value;
    delete property.value.auto;
    property.value.cleared = true;
    return ok();
}

/** Mark a set value as bootstrap's own. */
export function mark_auto(workfile: Workfile, symbol_name: string, property_name: string): Result<void> {
    const property = settable_property(workfile, symbol_name, property_name);
    if (!property.ok) {
        return property;
    }
    if (property.value.value === undefined) {
        return error(`'${symbol_name}.${property_name}' has no value for bootstrap to own`, property_name);
    }

    property.value.auto = true;
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
            $id: node.$symbol,
            // A descriptor node is a handle: a pointer global its init function fills in
            // (`capi_spi_init(&ctrl, ...)`), so it is already a pointer while a plain struct
            // is a value.
            expr: value,
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
        expr: owner_is_descriptor ? `${owner_name}->${member_name}` : `${owner_name}.${member_name}`,
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
        if (ruleset.$symbol === include_path) {
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

    // Hidden nodes that do not exist yet are offered by the name they would get: choosing
    // one is what brings it into being (on the next load, or bootstrap). That is how a pin
    // is pointed at another port's handle without anybody creating the handle first.
    const externs = build_extern_index(workfile.board);
    if (externs.ok) {
        for (const candidate of hidden_candidates(include_path, externs.value)) {
            if (!values.includes(candidate.name)) {
                values.push(candidate.name);
            }
        }
    }

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
            if (property.allowed.includes(ops.$symbol)) {
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
            if (property.allowed.includes(symbol.$symbol)) {
                values.push(name);
            }
        } else if (is_platform_symbol(symbol.$symbol) && symbol.$capability === parent_struct.$capability) {
            // No override restriction, fall back to capability matching
            values.push(name);
        }
    }

    for (const candidate of available.value.all) {
        if (!is_platform_symbol(candidate)) {
            continue;
        }

        const ruleset = load_resolved_ruleset(candidate);
        if (!ruleset.ok || ruleset.value._t !== "RulesetStruct") {
            continue;
        }

        // When an allowed list is set (from $override), only suggest from that list
        if (property.allowed) {
            if (property.allowed.includes(ruleset.value.$symbol)) {
                types.push(candidate);
            }
        } else if (ruleset.value.$capability === parent_struct.$capability) {
            // No override restriction, fall back to capability matching
            types.push(candidate);
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

    // What the part's overrides leave (adxl355 allows only CAPI_SPI_MODE_0), not the schema
    // alone: a suggestion the validator would then refuse is no suggestion.
    const graph = create_connections_graph(workfile);
    const overridden = apply_overrides(property, collect_child_overrides(symbol_name, workfile, graph), symbol_name, workfile).effective;

    switch (property._t) {
        case "NumberProperty": {
            const values = overridden._t === "NumberProperty" ? overridden.values : undefined;
            return ok(values === undefined ? {} : { values: values.map(value => format_number(value, overridden as NumberProperty)) });
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
            return suggest_for_enum(overridden as EnumProperty);
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
        case "DriverOpsProperty": {
            return suggest_driver_backed(workfile, property.interface, RulesetType.RT_EXTERN, symbol);
        }
        case "DriverInitParameterProperty": {
            return suggest_driver_backed(workfile, property.interface, RulesetType.RT_STRUCT, symbol);
        }
        case "RawProperty": {
            return ok({});
        }
        default: {
            return error("unknown type");
        }
    }
}

/**
 * Values and types for a driver-backed property.
 *
 * `values` are nodes already in the workfile that fit; `types` are the symbols that could be
 * added to make one. Both come from the modules declaring the interface, so a driver that is
 * not configured is simply not offered.
 */
function suggest_driver_backed(workfile: Workfile, interface_: string, type_: RulesetType, owner: Ruleset): Result<PropertySuggestions> {
    const candidates = type_ === RulesetType.RT_EXTERN
        ? driver_ops_candidates(interface_)
        : driver_init_parameter_candidates(interface_);
    if (!candidates.ok) {
        return candidates;
    }

    // Strong first: what the parts already in the workfile ship, then everything else that
    // provides the interface. A type already filling another config's field is left out.
    const { strong, weak } = rank_driver_candidates(workfile, candidates.value, owner);
    const types = [...strong, ...weak].map(entry => entry.$symbol);

    const values: string[] = [];
    for (const symbol of types) {
        for (const [name, ruleset] of Object.entries(workfile.symbols)) {
            if (ruleset.$symbol === symbol) {
                values.push(name);
            }
        }
    }

    return ok({
        values: values.length > 0 ? values : undefined,
        types: types.length > 0 ? types : undefined,
    });
}

export function list_available_structs(workfile: Workfile): Result<AvailableStructs> {
    const entries = all_symbols();
    if (!entries.ok) {
        return entries;
    }

    const by_module: Record<string, string[]> = {};
    const all: string[] = [];

    for (const entry of entries.value) {
        if (!is_instantiable(entry.$type)) {
            continue;
        }
        (by_module[entry.module.name] ??= []).push(entry.$symbol);
        all.push(entry.$symbol);
    }

    // The selected board's own peripherals, grouped under the board so it is clear they
    // come from the hardware rather than from a driver. board.yml is a catalog, not a
    // selection, so every one is offered and the user picks; adding one is what makes its
    // symbol referenceable. Without a board there are none to offer: the names are shared
    // across boards, so they only mean anything once one is chosen.
    if (workfile.board !== undefined) {
        const externs = board_externs(workfile.board);
        if (!externs.ok) {
            return externs;
        }
        for (const extern of externs.value.externs) {
            (by_module[workfile.board] ??= []).push(extern.$symbol);
            all.push(extern.$symbol);
        }
    }

    return ok({ by_module, all });
}

// Whether a kind of ruleset describes something a user can add to a workfile as a node.
// Enums are not instantiable; they only lower into an including property. An extern is,
// even though it configures nothing: adding it is what makes its symbol referenceable.
function is_instantiable(type_: RulesetType) {
    return type_ === RulesetType.RT_STRUCT
        || type_ === RulesetType.RT_DESCRIPTOR
        || type_ === RulesetType.RT_EXTERN;
};

// --- Transformations ---

export function export_minimal(workfile: Workfile): Result<MinimalWorkfile> {
    if (!workfile.platform) {
        return error("No platform loaded", "platform");
    }

    const symbols: MinimalWorkfile["symbols"] = {};

    const hidden = new Set(workfile.hidden ?? []);

    for (const [name, ruleset] of Object.entries(workfile.symbols)) {
        // Every user-created node kind. Platform ops are excluded because the platform
        // manifest reloads them, not the workfile.
        if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor" && ruleset._t !== "RulesetExtern") {
            continue;
        }

        // A hidden node is rebuilt from the name a stored node references it by.
        if (hidden.has(name)) {
            continue;
        }

        // An extern has no properties, so `$compatible` alone round-trips it.
        const properties = ruleset._t === "RulesetExtern" ? [] : ruleset.properties;
        const auto = properties.filter(property => property.auto === true && property.value !== undefined);

        const node: MinimalWorkfile["symbols"][string] = {
            $compatible: ruleset.$symbol,
            ...(auto.length === 0 ? {} : { [AUTO_KEY]: auto.map(property => property.name) }),
        };

        for (const property of properties) {
            if (property.value !== undefined) {
                node[property.name] = property.value;
            } else if (property.cleared === true) {
                // eslint-disable-next-line unicorn/no-null -- null is how the file says "set to nothing"
                node[property.name] = null;
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
        const ruleset_result = load_resolved_ruleset_for_board(node.$compatible, minimal.board);
        if (!ruleset_result.ok) {
            return ruleset_result;
        }

        const ruleset = ruleset_result.value;

        const add_result = add_symbol(workfile, name, ruleset);
        if (!add_result.ok) {
            return add_result;
        }

        for (const [property_name, value] of Object.entries(node)) {
            if (property_name === "$compatible" || property_name === AUTO_KEY) {
                continue;
            }
            const set_result = value === null
                ? clear_value(workfile, name, property_name)
                : set_value(workfile, name, property_name, value);
            if (!set_result.ok) {
                // A stored value the current schemas reject is a stale workfile, not a bad
                // command, so say which key to remove rather than only why it was refused.
                return error(
                    `Workfile symbol '${name}' cannot be loaded: ${set_result.error.message}. Remove '${property_name}' from it.`,
                    set_result.error.path
                );
            }
        }

        // Ownership is applied once every value is in place: it names values, not properties.
        const auto = node[AUTO_KEY];
        if (auto !== undefined) {
            if (!Array.isArray(auto) || !auto.every(entry => typeof entry === "string")) {
                return error(`Workfile symbol '${name}' cannot be loaded: '${AUTO_KEY}' must be a list of property names`, name);
            }
            for (const property_name of auto) {
                const marked = mark_auto(workfile, name, property_name);
                if (!marked.ok) {
                    return error(`Workfile symbol '${name}' cannot be loaded: ${marked.error.message}`, marked.error.path);
                }
            }
        }
    }

    // Hidden nodes are not in the file; the stored nodes name the ones they need.
    const rebuilt = materialize_referenced_hidden(workfile);
    if (!rebuilt.ok) {
        return rebuilt;
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

// --- Hidden nodes ---

/** Whether `name` is a hidden node: never written out, rebuilt from its name on load. */
export function is_hidden(workfile: Workfile, name: string): boolean {
    return workfile.hidden?.includes(name) === true;
}

function mark_hidden(workfile: Workfile, name: string): void {
    workfile.hidden = [...new Set([...(workfile.hidden ?? []), name])];
}

/**
 * Put a hidden node into the workfile, along with the extern a handle wraps.
 *
 * Idempotent: a hidden node is one resource, so asking for it twice gives the same node. A
 * STORED node already holding the name is a conflict, not the resource - the name is what
 * identifies the resource, so reusing the user's node would silently change what it is.
 */
export function materialize_hidden(workfile: Workfile, candidate: HiddenCandidate, externs: ExternIndex): Result<string> {
    if (candidate.name in workfile.symbols) {
        if (is_hidden(workfile, candidate.name)) {
            return ok(candidate.name);
        }
        return error(`'${candidate.name}' names a ${candidate.symbol} the board provides, but a node in the workfile already has that name`, candidate.name);
    }

    if (candidate.kind === "wrapper") {
        const wrapped = materialize_hidden(workfile, { kind: "extern", name: candidate.wraps, symbol: candidate.wraps }, externs);
        if (!wrapped.ok) {
            return wrapped;
        }
    }

    // A fresh copy every time: add_symbol stores the ruleset by reference.
    const loaded = externs.board.has(candidate.symbol)
        ? load_resolved_ruleset_for_board(candidate.symbol, workfile.board)
        : load_resolved_ruleset(candidate.symbol);
    if (!loaded.ok) {
        return loaded;
    }

    const added = add_symbol(workfile, candidate.name, loaded.value);
    if (!added.ok) {
        return added;
    }
    mark_hidden(workfile, candidate.name);

    if (candidate.kind === "wrapper") {
        const linked = set_value(workfile, candidate.name, "$init_param", candidate.wraps);
        if (!linked.ok) {
            return linked;
        }
    }

    return ok(candidate.name);
}

/** The type a reference-valued property's value must provide, and that value. */
function references_of(property: Property): { type_: string, value: string }[] {
    switch (property._t) {
        case "IncludeProperty": {
            return property.include !== undefined && typeof property.value === "string"
                ? [{ type_: property.include, value: property.value }]
                : [];
        }
        case "UnionProperty": {
            const binding = property.value as Record<string, unknown> | undefined;
            if (binding === undefined || typeof binding !== "object") {
                return [];
            }
            return Object.entries(binding).flatMap(([member_name, value]) => {
                const member = property.members.find(candidate => candidate.name === member_name);
                return member?.include !== undefined && typeof value === "string" ? [{ type_: member.include, value }] : [];
            });
        }
        default: {
            return [];
        }
    }
}

/**
 * Rebuild every hidden node a node in the workfile references but that is not there yet.
 *
 * The name says what to build: a reference whose value no node has is matched against the
 * hidden nodes that could provide the type the property expects. A driver's ops table is
 * the one reference matched by symbol rather than by type, because the property names an
 * interface, not a type.
 */
export function materialize_referenced_hidden(workfile: Workfile): Result<undefined> {
    const externs = build_extern_index(workfile.board);
    if (!externs.ok) {
        return externs;
    }

    for (const node of Object.values(workfile.symbols)) {
        if (node._t !== "RulesetStruct" && node._t !== "RulesetDescriptor") {
            continue;
        }

        for (const property of node.properties) {
            if (property._t === "DriverOpsProperty" && typeof property.value === "string" && !(property.value in workfile.symbols)) {
                const ops = property.value;
                const candidates = driver_ops_candidates(property.interface);
                if (candidates.ok && candidates.value.some(entry => entry.$symbol === ops)) {
                    const built = materialize_hidden(workfile, { kind: "extern", name: ops, symbol: ops }, externs.value);
                    if (!built.ok) {
                        return built;
                    }
                }
                continue;
            }

            for (const reference of references_of(property)) {
                if (reference.value in workfile.symbols) {
                    continue;
                }
                const candidate = hidden_candidates(reference.type_, externs.value).find(entry => entry.name === reference.value);
                if (candidate === undefined) {
                    continue; // a dangling reference is validation's to report
                }
                const built = materialize_hidden(workfile, candidate, externs.value);
                if (!built.ok) {
                    return built;
                }
            }
        }
    }

    return ok();
}

