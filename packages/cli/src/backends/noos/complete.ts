// `backend.complete`: the candidates for one word. It runs on every Tab, so it reads the
// workfile straight off disk and never prints: a workfile that doesn't load gives no
// candidates. The front end filters them by what is typed.

import fs from "node:fs";
import {
    PROBE_OPTIONS,
    addable_drivers,
    driver_interfaces,
    find_eval_board_module,
    get_workfile_path,
    import_minimal,
    list_available_structs,
    list_eval_boards,
    list_template_sets,
    suggest_for_property,
    type MinimalWorkfile,
    type Workfile,
} from "attach-no-os-lib";
import type { Candidate, Completion, Session, Slot } from "../../interface/backend-interface";
import { resolve_property_name } from "./commands/shared";
import { RESERVED_PREFIX } from "./protocol/convert";
import { install } from "./settings";

const NONE: Completion = { candidates: [] };

function values(list: readonly string[]): Completion {
    return { candidates: list.map(value => ({ value })) };
}

// Read straight off disk rather than through load_context: a completion request must
// answer in milliseconds and must never print, so a malformed workfile degrades to no
// suggestions instead of an error.
function minimal_workfile(): MinimalWorkfile | undefined {
    const resolved = get_workfile_path();
    if (!resolved.ok || !fs.existsSync(resolved.value)) {
        return undefined;
    }
    try {
        return JSON.parse(fs.readFileSync(resolved.value, "utf8")) as MinimalWorkfile;
    } catch {
        return undefined;
    }
}

function workfile(): Workfile | undefined {
    const minimal = minimal_workfile();
    if (minimal === undefined) {
        return undefined;
    }
    const imported = import_minimal(minimal);
    return imported.ok ? imported.value : undefined;
}

function node_names(): Candidate[] {
    const symbols = minimal_workfile()?.symbols ?? {};
    return Object.entries(symbols).map(([value, node]) => ({ value, description: node.$compatible }));
}

/**
 * A node's property names, without the `$`: the form that survives being typed, since a
 * shell expands an unquoted `$init_param` to nothing, and every command that takes a
 * property name accepts the bare spelling (resolve_property_name).
 */
function property_names(node_name: string, only_set: boolean): Candidate[] {
    const symbol = workfile()?.symbols[node_name];
    if (symbol === undefined || (symbol._t !== "RulesetStruct" && symbol._t !== "RulesetDescriptor")) {
        return [];
    }
    return symbol.properties
        .filter(property => property.disabled !== true)
        .filter(property => !only_set || (property.value !== undefined && property.value !== null))
        .map(property => ({
            value: property.name.startsWith(RESERVED_PREFIX) ? property.name.slice(RESERVED_PREFIX.length) : property.name,
            ...(property.required ? { description: "required" } : {}),
        }));
}

/** What a property can be set to; after a union's member, what that member can be. */
function value_candidates(node_name: string, property_name: string, member?: string): string[] {
    const loaded = workfile();
    const symbol = loaded?.symbols[node_name];
    if (loaded === undefined || symbol === undefined || (symbol._t !== "RulesetStruct" && symbol._t !== "RulesetDescriptor")) {
        return [];
    }
    const resolved = resolve_property_name(symbol, property_name);
    const suggestions = suggest_for_property(loaded, node_name, resolved, member);
    return suggestions.ok ? suggestions.value.values ?? [] : [];
}

function schema_keys(): string[] {
    const loaded = workfile();
    if (loaded === undefined) {
        return [];
    }
    const available = list_available_structs(loaded);
    if (!available.ok) {
        return [];
    }
    const drivers = addable_drivers();
    return [...list_eval_boards(), ...(drivers.ok ? drivers.value : []), ...available.value.all];
}

/** What `add <key> --as` takes: the interfaces of the driver the key names (or its eval board carries). */
function interface_candidates(key: string | undefined): Completion {
    if (key === undefined) { return NONE; }
    const driver = find_eval_board_module(key)?.implements_driver ?? key;
    const interfaces = driver_interfaces(driver);
    if (!interfaces.ok) { return NONE; }
    return { candidates: interfaces.value.map(({ interface: value, root }) => ({ value, description: root })) };
}

function flag_candidates(flag: string, prior: readonly string[]): Completion {
    switch (flag) {
        case "as": { return interface_candidates(prior[0]); }
        case "probe": { return values(PROBE_OPTIONS); }
        case "project-template": { return { candidates: list_template_sets().map(value => ({ value })), fallback: "dirs" }; }
        case "output": { return { candidates: [], fallback: "dirs" }; }
        default: { return NONE; }
    }
}

export function complete(slot: Slot, _partial: string, session: Session): Promise<Completion> {
    install(session);
    switch (slot.kind) {
        case "path": { return Promise.resolve({ candidates: node_names() }); }
        case "property": { return Promise.resolve({ candidates: property_names(slot.path, slot.command === "delete") }); }
        case "value": {
            // `update <node> <union> <member> <value>`: the second word is the member's value.
            const [member, ...more] = slot.prior;
            if (more.length > 0) {
                return Promise.resolve(NONE);
            }
            return Promise.resolve(values(value_candidates(slot.path, slot.property, member)));
        }
        case "device": { return Promise.resolve(values(schema_keys())); }
        case "source": { return Promise.resolve({ candidates: [], fallback: "files" }); }
        case "flag": { return Promise.resolve(flag_candidates(slot.flag, slot.prior)); }
        case "extra": { return Promise.resolve(NONE); }
    }
}
