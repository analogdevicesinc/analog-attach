import path from "node:path";
import { buildCommand } from "@stricli/core";
import { add_symbol, list_available_structs, load_resolved_ruleset } from "attach-no-os-lib";
import { filter_completions, get_node_names, get_schema_paths } from "../completion/completion";
import { common_ok, type AddResponse } from "../protocol/responses";
import { load_context, output, output_error, root_key, save_workfile, type WorkfileContext } from "./shared";

type AddFlags = {
    json?: boolean;
    key?: string;
    name?: string;
    to?: string[];
};

/**
 * `attach-noos add <schema> [--name <node>]` — create a node.
 *
 * The schema is the protocol's positional device key, the one aa-meta's base schema marks
 * `x-positional`. `--key` is kept as a second spelling of the same argument because that is
 * how every script in this repository writes it; the two must not disagree.
 *
 * The protocol allows `--name` on its own, with the tool inventing the key. We cannot: a
 * node here is an instance of a schema, and nothing but the caller knows which schema was
 * meant. So a name-only add is refused with a pointer at `list-devices` rather than guessed
 * at.
 *
 * `--to` is the protocol's parent path (a variadic array flag). It is accepted and must
 * name the root, because the workfile is a flat symbol table: every node is a root-level
 * node.
 */
export const addCommand = buildCommand<AddFlags, [string | undefined]>({
    docs: {
        brief: "Add a node to the workfile",
        fullDescription:
            "Creates a node from a schema. <schema> is the device key (see 'attach-noos list-devices')\n" +
            "and may also be given as --key; --name is what the node is called in the workfile,\n" +
            "defaulting to the schema's own name."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "schema",
                    brief: "Schema to instantiate (see: attach-noos list-devices)",
                    optional: true,
                    parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_schema_paths(), partial);
                    }
                }
            ]
        },
        flags: {
            key: {
                kind: "parsed",
                brief: "Schema to instantiate, as a flag instead of the positional",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_schema_paths(), partial);
                }
            },
            name: {
                kind: "parsed",
                brief: "Name for the new node (default: the schema's own name)",
                optional: true,
                parse: String
            },
            to: {
                kind: "parsed",
                brief: "Parent path; only the root is accepted, since the workfile is flat",
                optional: true,
                variadic: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_node_names(), partial);
                }
            },
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags: AddFlags, positional_key?: string) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message);
            return;
        }

        // One argument, two spellings. Silently preferring one would make a typo in the
        // other look like it had been honoured.
        if (positional_key !== undefined && flags.key !== undefined && positional_key !== flags.key) {
            output_error(
                flags,
                `Two different schemas given: '${positional_key}' and --key '${flags.key}'. Pass one.`
            );
            return;
        }

        const key = positional_key ?? flags.key;

        if (key === undefined) {
            output_error(
                flags,
                flags.name === undefined
                    ? "Nothing to add: pass <schema> (see: attach-noos list-devices)"
                    : `Cannot add '${flags.name}' without a schema: a node is an instance of a schema, ` +
                      "and there is no default schema. See: attach-noos list-devices"
            );
            return;
        }

        // A flat symbol table has exactly one place to put a node. Refusing a parent is
        // better than accepting one and silently ignoring it.
        const root = root_key(context.value);
        const parent = (flags.to ?? []).filter(segment => segment !== "");
        if (parent.length > 1 || (parent.length === 1 && parent[0] !== root)) {
            output_error(
                flags,
                `'${parent.join(" ")}' cannot hold a node: this workfile is flat, so every node lives at the root ('${root}')`
            );
            return;
        }

        const available = list_available_structs(context.value.workfile);
        if (!available.ok) {
            output_error(flags, available.error.message);
            return;
        }

        const keys = [...available.value.devices, ...available.value.noos, ...available.value.platform];
        if (!keys.includes(key)) {
            output_error(flags, `Unknown schema '${key}'. See: attach-noos list-devices`);
            return;
        }

        const name = flags.name ?? unique_name(default_name(key), context.value);
        if (context.value.workfile.symbols[name]) {
            output_error(flags, `'${name}' already exists. Pass --name to choose another name.`);
            return;
        }

        const ruleset = load_resolved_ruleset(key);
        if (!ruleset.ok) {
            output_error(flags, ruleset.error.message);
            return;
        }

        const changed = add_symbol(context.value.workfile, name, ruleset.value);
        if (!changed.ok) {
            output_error(flags, changed.error.message);
            return;
        }

        context.value.workfile = changed.value;

        const saved = save_workfile(context.value);
        if (!saved.ok) {
            output_error(flags, saved.error.message);
            return;
        }

        const message = `Added '${name}' (${key})`;
        const response: AddResponse = {
            ...common_ok(message),
            key,
            path: [name]
        };

        output(flags, `${message}\n  ${context.value.path}`, response);
    }
});

/** `devices/ad7124/ad7124_init_param.yaml` → `ad7124_init_param`. */
function default_name(key: string): string {
    return path.basename(key, path.extname(key));
}

function unique_name(base: string, context: WorkfileContext): string {
    if (!context.workfile.symbols[base]) {
        return base;
    }

    for (let index = 1; ; index++) {
        const candidate = `${base}_${index}`;
        if (!context.workfile.symbols[candidate]) {
            return candidate;
        }
    }
}
