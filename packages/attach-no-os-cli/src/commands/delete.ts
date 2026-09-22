import { buildCommand } from "@stricli/core";
import {
    get_connected_symbols,
    remove_symbol,
    set_value,
    type Result,
    type Workfile
} from "attach-no-os-lib";
import type { AttachContext, WorkfileContext } from "./shared";
import {
    load_context,
    save_workfile,
    output,
    output_error,
    get_any_node,
    get_node_property,
    root_key
} from "./shared";
import {
    prior_positionals,
    filter_completions,
    get_node_names,
    get_property_names
} from "../completion/completion";
import { common_ok, type DeletePreview } from "../protocol/responses";

type DeleteFlags = {
    json?: boolean;
    force?: boolean;
};

/** One property, somewhere in the workfile, whose value points at the node being deleted. */
type Reference = {
    owner: string;
    property: string;
};

/**
 * `attach-noos delete [node] [property]` — remove a node, or reset one of its properties.
 *
 * A property is a fixed part of its node's schema, so "deleting" one means clearing its
 * value; that is never destructive beyond the one value and needs no confirmation. A node
 * is different: other nodes may point at it, and removing it would strand them. Those
 * references are what makes a node "non-leaf" here, so a node that is referenced returns a
 * DeletePreview and changes nothing until `--force` says to clear the references too.
 *
 * With no arguments the target is the root — the whole workfile — which is always a preview
 * first.
 */
export const deleteCommand = buildCommand<
    DeleteFlags,
    [string | undefined, string | undefined],
    AttachContext
>({
    docs: {
        brief: "Delete a node, or reset a property",
        fullDescription:
            "With <node> <property>, clears that property's value.\n" +
            "With <node>, removes the node; --force is required if anything references it.\n" +
            "With no arguments, removes every node; --force is required."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "node", brief: "Node name", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_node_names(), partial);
                    }
                },
                {
                    placeholder: "property", brief: "Property to reset", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        const [node] = prior_positionals(this, 1);
                        return filter_completions(get_property_names(node), partial);
                    }
                }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            force: { kind: "boolean", brief: "Carry out a delete that would affect more than its target", optional: true }
        }
    },
    func: async (flags: DeleteFlags, node, property) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message);
            return;
        }

        // attach-noos delete — the root, meaning everything in it
        if (!node) {
            delete_everything(flags, context.value);
            return;
        }

        const found = get_any_node(context.value, node);
        if (!found.ok) {
            output_error(flags, found.error.message);
            return;
        }

        // attach-noos delete <node> <property> — clear one value
        if (property) {
            reset_property(flags, context.value, node, property);
            return;
        }

        // attach-noos delete <node> — remove the node, and whatever pointed at it
        delete_node(flags, context.value, node);
    }
});

// ------- OPERATIONS --------

function reset_property(flags: DeleteFlags, context: WorkfileContext, node: string, property: string): void {
    const lookup = get_node_property(context, node, property);
    if (!lookup.ok) {
        output_error(flags, lookup.error.message);
        return;
    }

    // The lookup's own name, not what was typed: `delete <node> init_param` resolves to
    // `$init_param`, and the lib only knows the workfile's spelling.
    const resolved = lookup.value.property.name;

    // No value argument: set_value clears the property.
    const cleared = set_value(context.workfile, node, resolved);
    if (!cleared.ok) {
        output_error(flags, cleared.error.message);
        return;
    }

    if (!write(flags, context)) {
        return;
    }

    const message = `Reset ${node}.${resolved}`;
    output(flags, message, common_ok(message));
}

function delete_node(flags: DeleteFlags, context: WorkfileContext, node: string): void {
    const references = find_references(context.workfile, node);

    if (references.length > 0 && !flags.force) {
        preview(
            flags,
            `'${node}' is referenced by ${count(references.length, "property")}; deleting it would clear ${references.length === 1 ? "that reference" : "those references"}. Re-run with --force.`,
            {
                node_count: 1,
                property_count: references.length,
                paths: [[node], ...references.map(reference => [reference.owner, reference.property])]
            },
            `${node} — referenced by:\n\n`
            + references.map(reference => `  ${reference.owner}.${reference.property}\n`).join("")
            + "\nNothing was changed. Re-run with --force to delete the node and clear those references."
        );
        return;
    }

    for (const reference of references) {
        const cleared = clear_reference(context.workfile, reference, node);
        if (!cleared.ok) {
            output_error(
                flags,
                `Cannot delete '${node}': ${reference.owner}.${reference.property} references it and could not be `
                + `cleared (${cleared.error.message}). Delete '${reference.owner}' instead.`
            );
            return;
        }
    }

    const removed = remove_symbol(context.workfile, node);
    if (!removed.ok) {
        output_error(flags, removed.error.message);
        return;
    }

    if (!write(flags, context)) {
        return;
    }

    const message = references.length > 0
        ? `Deleted '${node}' and cleared ${count(references.length, "reference")} to it`
        : `Deleted '${node}'`;
    output(flags, message, common_ok(message));
}

function delete_everything(flags: DeleteFlags, context: WorkfileContext): void {
    const names = Object.keys(context.workfile.symbols);

    if (names.length === 0) {
        const message = "Nothing to delete: the workfile has no nodes";
        output(flags, message, common_ok(message));
        return;
    }

    if (!flags.force) {
        preview(
            flags,
            `Deleting the root removes every node in the workfile (${count(names.length, "node")}). Re-run with --force.`,
            {
                node_count: names.length,
                property_count: property_count(context.workfile),
                paths: names.map(name => [name])
            },
            `${root_key(context)} — would delete ${count(names.length, "node")}:\n\n`
            + names.map(name => `  ${name}\n`).join("")
            + "\nNothing was changed. Re-run with --force to delete them all."
        );
        return;
    }

    for (const name of names) {
        const removed = remove_symbol(context.workfile, name);
        if (!removed.ok) {
            output_error(flags, removed.error.message);
            return;
        }
    }

    if (!write(flags, context)) {
        return;
    }

    const message = `Deleted ${count(names.length, "node")}`;
    output(flags, message, common_ok(message));
}

// ------- HELPERS --------

/** Save, reporting the failure the same way every other step does. False means it failed. */
function write(flags: DeleteFlags, context: WorkfileContext): boolean {
    const saved = save_workfile(context);
    if (!saved.ok) {
        output_error(flags, saved.error.message);
        return false;
    }

    return true;
}

/**
 * A refused delete: what *would* go, with nothing written.
 *
 * `ok: true` on purpose — being asked to confirm is not a failure, and the counts are the
 * answer to the question attach-meta asked.
 */
function preview(
    flags: DeleteFlags,
    message: string,
    counts: Pick<DeletePreview, "node_count" | "property_count" | "paths">,
    text: string
): void {
    const response: DeletePreview = { ...common_ok(message, "warn"), ...counts };
    output(flags, text, response);
}

/** Every property, in any other node, whose value points at `target`. */
function find_references(workfile: Workfile, target: string): Reference[] {
    const references: Reference[] = [];

    for (const [owner, ruleset] of Object.entries(workfile.symbols)) {
        if (owner === target || (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor")) {
            continue;
        }

        for (const property of ruleset.properties) {
            if (get_connected_symbols(property).includes(target)) {
                references.push({ owner, property: property.name });
            }
        }
    }

    return references;
}

/**
 * Unpoint one property from `target`.
 *
 * An array can hold several references, and the siblings are still valid, so only the
 * deleted name is dropped from it. Everything else holds exactly one reference and is
 * cleared outright.
 */
function clear_reference(workfile: Workfile, reference: Reference, target: string): Result<void> {
    const owner = workfile.symbols[reference.owner];
    const property = owner?._t === "RulesetStruct" || owner?._t === "RulesetDescriptor"
        ? owner.properties.find(candidate => candidate.name === reference.property)
        : undefined;

    if (property?._t === "ArrayProperty" && Array.isArray(property.value)) {
        const kept = (property.value as unknown[]).filter(element => element !== target);
        return set_value(workfile, reference.owner, reference.property, kept.length > 0 ? kept : undefined);
    }

    return set_value(workfile, reference.owner, reference.property);
}

function property_count(workfile: Workfile): number {
    let total = 0;
    for (const ruleset of Object.values(workfile.symbols)) {
        if (ruleset._t === "RulesetStruct" || ruleset._t === "RulesetDescriptor") {
            total += ruleset.properties.length;
        }
    }

    return total;
}

function count(amount: number, noun: string): string {
    return `${amount} ${noun}${amount === 1 ? "" : "s"}`;
}
