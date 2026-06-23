import { Result, ok, error } from "../bindings_parser/result";
import { ArrayProperty, IncludeProperty, Property, Ruleset, RulesetStruct, UnionProperty } from "../bindings_parser/types";
import { ParseContext, at } from "../bindings_parser/validators";
import { Workfile } from "./types";

export class WorkfileHandler {
    private workfile: Workfile;

    constructor() {
        this.workfile = { symbols: {} };
    }

    // --- Symbol CRUD ---

    add_symbol(name: string, ruleset: Ruleset): Result<void> {
        if (name in this.workfile.symbols) {
            return error(`Symbol '${name}' already exists`, "name");
        }
        this.workfile.symbols[name] = ruleset;
        return ok();
    }

    get_symbol(name: string): Result<Ruleset> {
        if (!(name in this.workfile.symbols)) {
            return error(`Symbol '${name} does not exist'`, "name");
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
            return error(`Symbol '${symbol_name}' not found`, "name");
        }
        return ok(property.value);
    }

    // --- Private Helpers ---

    private get_struct(symbol_name: string, context: ParseContext): Result<RulesetStruct> {
        const ruleset = this.workfile.symbols[symbol_name];
        if (!ruleset) {
            return error(`Symbol '${symbol_name}' not found`, context.path);
        }
        if (ruleset._t !== "BindingStuct") {
            return error(`Symbol '${symbol_name}' is not a struct`, context.path);
        }
        return ok(ruleset);
    }

    private get_property(ruleset: RulesetStruct, property_name: string, context: ParseContext): Result<Property> {
        const property = ruleset.properties.find(p => p.name === property_name);
        if (!property) {
            return error(`Property '${property_name}' not found`, context.path);
        }
        return ok(property);
    }

    // --- Include Validation ---

    validate_include(symbol_name: string, property_name: string): Result<void> {
        const context: ParseContext = { path: symbol_name, document: {} };

        const ruleset = this.get_struct(symbol_name, context);
        if (!ruleset.ok) {return ruleset;}

        const property_context = at(context, property_name);
        const property = this.get_property(ruleset.value, property_name, property_context);
        if (!property.ok) {return property;}

        if (property.value._t !== "IncludeProperty") {
            return error(`Property '${property_name}' is not an include`, property_context.path);
        }

        const value_context = at(property_context, "value");
        const target_symbol_name = property.value.value as string | undefined;
        if (!target_symbol_name) {
            return error(`Include has no value set`, value_context.path);
        }

        const target = this.get_symbol(target_symbol_name);
        if (!target.ok) {
            return error(`Target symbol '${target_symbol_name}' not found`, value_context.path);
        }

        if (target.value.$id !== property.value.include) {
            return error(
                `Type mismatch: '${target_symbol_name}' is '${target.value.$id}', expected '${property.value.include}'`,
                value_context.path
            );
        }

        return ok();
    }

    // --- Union Validation ---

    validate_union(symbol_name: string, property_name: string): Result<void> {
        const context: ParseContext = { path: symbol_name, document: {} };

        const ruleset = this.get_struct(symbol_name, context);
        if (!ruleset.ok) {return ruleset;}

        const property_context = at(context, property_name);
        const property = this.get_property(ruleset.value, property_name, property_context);
        if (!property.ok) {return property;}

        if (property.value._t !== "UnionProperty") {
            return error(`Property '${property_name}' is not a union`, property_context.path);
        }

        const value_context = at(property_context, "value");
        const value = property.value.value as Record<string, string> | undefined;
        if (!value) {
            return error(`Union has no value set`, value_context.path);
        }

        const keys = Object.keys(value);
        if (keys.length !== 1) {
            return error(`Union value must have exactly one key`, value_context.path);
        }

        const selected_member_name = keys[0];
        const target_symbol_name = value[selected_member_name];
        const member_context = at(value_context, selected_member_name);

        const member = property.value.members.find(m => m.name === selected_member_name);
        if (!member) {
            return error(`Unknown union member '${selected_member_name}'`, member_context.path);
        }

        const target = this.get_symbol(target_symbol_name);
        if (!target.ok) {
            return error(`Target symbol '${target_symbol_name}' not found`, member_context.path);
        }

        if (target.value.$id !== member.include) {
            return error(
                `Type mismatch: '${target_symbol_name}' is '${target.value.$id}', expected '${member.include}'`,
                member_context.path
            );
        }

        return ok();
    }

    // --- Array Validation ---

    validate_array(symbol_name: string, property_name: string): Result<void> {
        const context: ParseContext = { path: symbol_name, document: {} };

        const ruleset = this.get_struct(symbol_name, context);
        if (!ruleset.ok) {return ruleset;}

        const property_context = at(context, property_name);
        const property = this.get_property(ruleset.value, property_name, property_context);
        if (!property.ok) {return property;}

        if (property.value._t !== "ArrayProperty") {
            return error(`Property '${property_name}' is not an array`, property_context.path);
        }

        if (property.value.element._t !== "IncludeProperty") {
            return error(`Array element is not an include`, at(property_context, "element").path);
        }

        const value_context = at(property_context, "value");
        const value = property.value.value as string[] | undefined;
        if (!value) {
            return error(`Array has no value set`, value_context.path);
        }

        if (value.length !== property.value.size) {
            return error(
                `Array must have ${property.value.size} elements, got ${value.length}`,
                value_context.path
            );
        }

        const element = property.value.element;
        for (const [index, target_symbol_name] of value.entries()) {
            const index_context = at(value_context, index);

            const target = this.get_symbol(target_symbol_name);
            if (!target.ok) {
                return error(`Target symbol '${target_symbol_name}' not found`, index_context.path);
            }

            if (target.value.$id !== element.include) {
                return error(
                    `Type mismatch: '${target_symbol_name}' is '${target.value.$id}', expected '${element.include}'`,
                    index_context.path
                );
            }
        }

        return ok();
    }

    // --- Suggestions ---

    suggest_for_include(include: IncludeProperty): string[] {
        const suggestions: string[] = [];
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

    // --- Persistence ---

    export_workfile(): Workfile {
        return structuredClone(this.workfile);
    }

    load_workfile(workfile: Workfile): void {
        this.workfile = workfile;
    }
}
