import { Result, ok, error } from "../bindings_parser/result";
import { ArrayProperty, IncludeProperty, Ruleset, RulesetPlatformOps, UnionProperty } from "../bindings_parser/types";
import { PlatformManifest } from "../context_handler/types";
import { BindingLoader, LoadPlatformResult, Workfile } from "./types";

export class WorkfileHandler {
    private workfile: Workfile;

    constructor() {
        this.workfile = { platform_ops: {}, symbols: {} };
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

    suggest_for_include(include: IncludeProperty): string[] {
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
        return suggestions;
    }

    suggest_for_union(union: UnionProperty, member_name: string): Result<string[]> {
        const member = union.members.find(m => m.name === member_name);
        if (!member) {
            return error(`Unknown union member '${member_name}'`, member_name);
        }
        return ok(this.suggest_for_include(member));
    }

    suggest_for_array(array: ArrayProperty): Result<string[]> {
        if (array.element._t !== "IncludeProperty") {
            return error(`Array element is not an include`, "element");
        }
        return ok(this.suggest_for_include(array.element));
    }

    // --- Platform Loading ---

    load_platform(
        manifest: PlatformManifest,
        load_binding: BindingLoader
    ): Result<LoadPlatformResult> {
        // Clear existing platform ops
        this.clear_platform_ops();

        // Load each ops binding
        for (const ops_path of manifest.ops) {
            const ruleset_result = load_binding(ops_path);
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

        return ok({
            available_structs: manifest.structs,
        });
    }

    // --- Persistence ---

    export_workfile(): Workfile {
        return structuredClone(this.workfile);
    }

    load_workfile(workfile: Workfile): void {
        this.workfile = workfile;
    }
}
