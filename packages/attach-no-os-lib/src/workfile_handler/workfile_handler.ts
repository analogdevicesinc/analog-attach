import path from "node:path";
import { Result, ok, error } from "../bindings_parser/result";
import { ArrayProperty, EnumProperty, IncludeProperty, PlatformExtraProperty, PlatformOpsProperty, Ruleset, RulesetPlatformOps, RulesetStruct, UnionProperty } from "../bindings_parser/types";
import { scan_platforms } from "../context_handler/platform_scanner";
import { PlatformManifest } from "../context_handler/types";
import { load_resolved_binding } from "../resolver/resolver";
import { get_schemas_path } from "../settings/settings";
import { collect_child_overrides, create_connections_graph } from "../validator/connection_graph";
import { apply_overrides } from "../validator/override_resolver";
import { AvailableStructs, LoadPlatformResult, MinimalWorkfile, Workfile } from "./types";
import fs from "node:fs";

export class WorkfileHandler {
    private workfile: Workfile;
    private platform_structs: string[];
    private platform_name: string | undefined;

    constructor() {
        this.workfile = { platform_ops: {}, symbols: {} };
        this.platform_structs = [];
        this.platform_name = undefined;
    }

    // --- Platform Ops (locked, from manifest) ---

    add_platform_ops(name: string, ruleset: RulesetPlatformOps): Result<void> {
        if (name in this.workfile.platform_ops) {
            return error(`Platform ops '${name}' already exists`, "name");
        }
        this.workfile.platform_ops[name] = ruleset;
        return ok();
    }

    get_platform_ops(name: string): Result<RulesetPlatformOps> {
        const ops = this.workfile.platform_ops[name];
        if (!ops) {
            return error(`Platform ops '${name}' not found`, "name");
        }
        return ok(ops as RulesetPlatformOps);
    }

    list_platform_ops(): string[] {
        return Object.keys(this.workfile.platform_ops);
    }

    clear_platform_ops(): void {
        this.workfile.platform_ops = {};
    }

    // --- Symbol CRUD (user-created) ---

    add_symbol(name: string, ruleset: Ruleset): Result<void> {
        if (name in this.workfile.symbols) {
            return error(`Symbol '${name}' already exists`, "name");
        }
        if (name in this.workfile.platform_ops) {
            return error(`Symbol '${name}' conflicts with platform ops`, "name");
        }
        this.workfile.symbols[name] = ruleset;
        return ok();
    }

    get_symbol(name: string): Result<Ruleset> {
        if (!(name in this.workfile.symbols)) {
            return error(`Symbol '${name}' does not exist`, "name");
        }
        return ok(this.workfile.symbols[name]);
    }

    remove_symbol(name: string): Result<void> {
        if (!(name in this.workfile.symbols)) {
            return error(`Symbol '${name}' not found`, "name");
        }
        delete this.workfile.symbols[name];
        return ok();
    }

    list_symbols(): string[] {
        return Object.keys(this.workfile.symbols);
    }

    // --- Lookup (checks both platform_ops and symbols) ---

    find_any(name: string): Ruleset | undefined {
        return this.workfile.platform_ops[name] ?? this.workfile.symbols[name];
    }

    // --- Property Values ---

    set_value(symbol_name: string, property_name: string, value: unknown): Result<void> {
        const ruleset = this.workfile.symbols[symbol_name];
        if (!ruleset) {
            return error(`Symbol '${symbol_name}' not found`, "symbol_name");
        }
        if (ruleset._t !== "BindingStuct") {
            return error(`Symbol '${symbol_name}' is not a struct`, "symbol_name");
        }

        const property = ruleset.properties.find(p => p.name === property_name);
        if (!property) {
            return error(`Property '${property_name}' not found in '${symbol_name}'`, "property_name");
        }

        property.value = value;
        return ok();
    }

    get_value(symbol_name: string, property_name: string): Result<any> {
        const ruleset = this.workfile.symbols[symbol_name];
        if (!ruleset || ruleset._t !== "BindingStuct") {
            return error(`Symbol '${symbol_name}' is not a struct`, "symbol_name");
        }

        const property = ruleset.properties.find(p => p.name === property_name);
        if (property === undefined) {
            return error(`Property '${property_name}' not found`, "property_name");
        }
        return ok(property.value);
    }

    // --- Suggestions ---

    suggest_for_include(include: IncludeProperty): Result<string[]> {
        const suggestions: string[] = [];
        // Check both platform_ops and symbols
        for (const [name, ruleset] of Object.entries(this.workfile.platform_ops)) {
            if (ruleset.$id === include.include) {
                suggestions.push(name);
            }
        }
        for (const [name, ruleset] of Object.entries(this.workfile.symbols)) {
            if (ruleset.$id === include.include) {
                suggestions.push(name);
            }
        }
        return ok(suggestions);
    }

    suggest_for_union(union: UnionProperty, member_name?: string): Result<string[]> {
        // Suggest a member if no member is provided
        if (member_name === undefined) {
            return ok(union.members.map(p => p.name));
        }

        const member = union.members.find(m => m.name === member_name);
        if (!member) {
            return error(`Unknown union member '${member_name}'`, member_name);
        }
        return this.suggest_for_include(member);
    }

    suggest_for_array(array: ArrayProperty): Result<string[]> {
        if (array.element._t !== "IncludeProperty") {
            return error(`Array element is not an include`, "element");
        }
        return this.suggest_for_include(array.element);
    }

    suggest_for_enum(property: EnumProperty): Result<string[]> {
        return ok(property.values.map(p => typeof p === "number" ? p.toString() : p));
    }

    suggest_platform_ops(property: PlatformOpsProperty, parent_struct: RulesetStruct): Result<string[]> {
        const suggestions: string[] = [];
        
        for (const [name, ops] of Object.entries(this.workfile.platform_ops)) {
            if (ops._t !== "BindingPlatformOps") {
                continue;
            }

            if (property.allowed && property.allowed.includes(ops.$id)) {
                suggestions.push(name);
            } else if (ops.$capability === parent_struct.$capability) {
                suggestions.push(name);
            }
        }

        return ok(suggestions);
    }

    suggest_platform_extra(property: PlatformExtraProperty, parent_struct: RulesetStruct): Result<string[]> {
        const suggestions: string[] = [];

        for (const [name, symbol] of Object.entries(this.workfile.symbols)) {
            if (symbol._t !== "BindingStuct") {
                continue;
            }

            if (property.allowed && property.allowed.includes(symbol.$id)) {
                suggestions.push(name);
            } else if (symbol.$capability === parent_struct.$capability) {
                suggestions.push(name);
            }
        }

        return ok(suggestions);
    }

    suggest_for_property(symbol_name: string, property_name: string, union_member?: string): Result<string[]> {
        const symbol = this.workfile.symbols[symbol_name];
        if (!symbol) {
            return error(`Could not find symbol with name: "${symbol_name}" in [${Object.keys(this.workfile.symbols)}]`, "");
        }

        if (symbol._t !== "BindingStuct") {
            return error(`Expected type BindingStruct, got "${symbol._t}"`, "");
        }

        const property = symbol.properties.find(p => p.name === property_name);
        if (!property) {
            return error(`Could not find property "${property_name}" in [${symbol.properties.join(", ")}]`, symbol_name);
        }

        switch (property._t) {
            case "NumberProperty": {
                return ok([]);
            }
            case "BooleanProperty": {
                // I don't think we might enforce this somehow?
                return ok(["true", "false"]);
            }
            case "StringProperty": {
                return ok([]);
            }
            case "IncludeProperty": {
                return this.suggest_for_include(property);
            }
            case "EnumProperty": {
                return this.suggest_for_enum(property);
            }
            case "UnionProperty": {
                return this.suggest_for_union(property, union_member);
            }
            case "ArrayProperty": {
                return this.suggest_for_array(property);
            }
            case "PlatformOpsProperty": {
                const graph = create_connections_graph(this.workfile);
                const child_overrides = collect_child_overrides(symbol_name, this.workfile, graph);
                const effective = apply_overrides(property, child_overrides, symbol);
                return this.suggest_platform_ops(effective as PlatformOpsProperty, symbol);
            }
            case "PlatformExtraProperty": {
                const graph = create_connections_graph(this.workfile);
                const child_overrides = collect_child_overrides(symbol_name, this.workfile, graph);
                const effective = apply_overrides(property, child_overrides, symbol);
                return this.suggest_platform_extra(effective as PlatformExtraProperty, symbol);
            }
            case "CallbackFunctionProperty": {
                return ok([]);
            }
            case "CallbackContextProperty": {
                return ok([]);
            }
            default: {
                return error("unknown type", "");
            }
        }
    }

    list_available_structs(): Result<AvailableStructs> {
        const schema_path = get_schemas_path();
        if (!schema_path) {
            return error("Schema path not set", "settings");
        }

        const devices = this.scan_yaml_files(path.join(schema_path, "devices"));
        if (!devices.ok) {
            return error(`Path ${path.join(schema_path, "devices")} not found`, "");
        }

        const noos = this.scan_yaml_files(path.join(schema_path, "no-os"));
        if (!noos.ok) {
            return error(`Path ${path.join(schema_path, "noos")} not found`, "");
        }

        return ok({
            devices: devices.value,
            noos: noos.value,
            platform: this.platform_structs
        });
    }

    private scan_yaml_files(directory: string): Result<string[]> {
        const schema_path = get_schemas_path();
        if (!schema_path || !fs.readdirSync(directory)) {
            return error("Schema path not set", "settings");
        }

        const results: string[] = [];
        const scan = (current: string) => {
            const entries = fs.readdirSync(current, { withFileTypes: true });
            for (const entry of entries) {
                const full_path = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    scan(full_path);
                } else if (entry.name.endsWith(".yaml")) {
                    results.push(path.relative(schema_path, full_path));
                }
            }
        };

        scan(directory);
        return ok(results);
    }

    // --- Platform Loading ---

    load_platform(manifest: PlatformManifest): Result<LoadPlatformResult> {
        // Clear existing platform ops
        this.clear_platform_ops();

        // Load each ops binding
        for (const ops_path of manifest.ops) {
            const ruleset_result = load_resolved_binding(ops_path);
            if (!ruleset_result.ok) {
                return ruleset_result;
            }

            const ruleset = ruleset_result.value;
            if (ruleset._t !== "BindingPlatformOps") {
                return error(`Expected platform_ops binding, got ${ruleset._t}: ${ops_path}`, ops_path);
            }

            const add_result = this.add_platform_ops(ruleset.$symbol, ruleset);
            if (!add_result.ok) {
                return add_result;
            }
        }

        this.platform_structs = manifest.structs;
        this.platform_name = manifest.name;

        return ok({
            available_structs: manifest.structs,
        });
    }

    // --- Transformations ---
    export_minimal(): Result<MinimalWorkfile> {
        if (!this.platform_name) {
            return error("No platform loaded", "platform");
        }

        const symbols: MinimalWorkfile["symbols"] = {};

        for (const [name, ruleset] of Object.entries(this.workfile.symbols)) {
            if (ruleset._t !== "BindingStuct") {
                continue;
            }

            const node: MinimalWorkfile["symbols"][string] = {
                $compatible: ruleset.$id
            };

            for (const property of ruleset.properties) {
                if (property.value !== undefined) {
                    node[property.name] = property.value;
                }
            }

            symbols[name] = node;
        }

        return ok({
            platform: this.platform_name,
            symbols
        });
    }

    import_minimal(minimal: MinimalWorkfile): Result<void> {
        const schemas_path = get_schemas_path();
        if (!schemas_path) {
            return error("Schemas path not set", "settings");
        }

        // Find platform by name using scan_platforms
        const platforms_result = scan_platforms(path.join(schemas_path, "platforms"));
        if (!platforms_result.ok) {
            return platforms_result;
        }

        const manifest = platforms_result.value[minimal.platform];
        if (!manifest) {
            return error(`Platform '${minimal.platform}' not found`, "platform");
        }

        // Load the platform
        const load_result = this.load_platform(manifest);
        if (!load_result.ok) {
            return load_result;
        }

        // Clear existing symbols
        this.workfile.symbols = {};

        // Load each symbol
        for (const [name, node] of Object.entries(minimal.symbols)) {
            const binding_result = load_resolved_binding(node.$compatible);
            if (!binding_result.ok) {
                return binding_result;
            }

            const add_result = this.add_symbol(name, binding_result.value);
            if (!add_result.ok) {
                return add_result;
            }

            // Set property values (skip $compatible)
            for (const [property_name, value] of Object.entries(node)) {
                if (property_name === "$compatible") {
                    continue;
                }
                const set_result = this.set_value(name, property_name, value);
                if (!set_result.ok) {
                    return set_result;
                }
            }
        }

        return ok();
    }

    // --- Persistence ---

    export_workfile(): Workfile {
        return structuredClone(this.workfile);
    }

    load_workfile(workfile: Workfile): void {
        this.workfile = workfile;
    }
}
