import {
    get_connected_symbols,
    referenced_nodes,
    remove_symbol,
    clear_value,
    set_value,
    type Result,
    type Workfile
} from "attach-no-os-lib";
import { answer, command, refuse, type DeleteArguments, type Outcome } from "../../../interface/backend-interface";
import { describe_bootstrap, run_bootstrap } from "./bootstrap_run";
import {
    get_any_node,
    get_node_property,
    load_context,
    root_key,
    save_workfile,
    type WorkfileContext
} from "./shared";
import { common_ok, type CommonResponse, type DeletePreview } from "../protocol/responses";

type DeleteResponse = CommonResponse | DeletePreview;

/** One property, somewhere in the workfile, whose value points at the node being deleted. */
type Reference = {
    owner: string;
    property: string;
};

/**
 * `delete [node] [property]`: remove a node, or reset one of its properties.
 *
 * A property is a fixed part of its node's schema, so "deleting" one means clearing its
 * value; that is never destructive beyond the one value and needs no confirmation. A node
 * is different: other nodes may point at it, and removing it would strand them. Those
 * references are what makes a node "non-leaf" here, so a node that is referenced returns a
 * DeletePreview and changes nothing until `--force` says to clear the references too.
 *
 * With no arguments the target is the root (the whole workfile), which is always a preview
 * first.
 */
export const delete_command = command<DeleteArguments, DeleteResponse>({
    docs: {
        brief: "Delete a node, or reset a property",
        full:
            "With <node> <property>, clears that property's value.\n" +
            "With <node>, removes the node; --force is required if anything references it.\n" +
            "With no arguments, removes every node; --force is required."
    },
    run({ path: node, property, force }, _flags, session) {
        const context = load_context(session);
        if (!context.ok) {
            return Promise.resolve(refuse(context.error.message));
        }
        const { program } = session;

        // delete: the root, meaning everything in it
        if (node === undefined || node === "") {
            return Promise.resolve(delete_everything(context.value, force, program));
        }

        const found = get_any_node(context.value, node);
        if (!found.ok) {
            return Promise.resolve(refuse(found.error.message));
        }

        // delete <node> <property>: clear one value
        if (property !== undefined && property !== "") {
            return Promise.resolve(reset_property(context.value, node, property, program));
        }

        // delete <node>: remove the node, and whatever pointed at it
        return Promise.resolve(delete_node(context.value, node, force, program));
    }
});

// ------- OPERATIONS --------

function reset_property(context: WorkfileContext, node: string, property: string, program: string): Outcome<DeleteResponse> {
    const lookup = get_node_property(context, node, property);
    if (!lookup.ok) {
        return refuse(lookup.error.message);
    }

    // The lookup's own name, not what was typed: `delete <node> init_param` resolves to
    // `$init_param`, and the lib only knows the workfile's spelling.
    const resolved = lookup.value.property.name;

    // The user's "nothing": unset, and not bootstrap's to fill back in.
    const referenced_before = referenced_nodes(context.workfile);
    const cleared = clear_value(context.workfile, node, resolved);
    if (!cleared.ok) {
        return refuse(cleared.error.message);
    }

    const message = `Reset ${node}.${resolved}`;
    const bootstrapped = write(context, message, program, referenced_before);
    if (!Array.isArray(bootstrapped)) {
        return bootstrapped;
    }
    return answer(common_ok(message), [message, ...bootstrapped].join("\n"));
}

function delete_node(context: WorkfileContext, node: string, force: boolean, program: string): Outcome<DeleteResponse> {
    const references = find_references(context.workfile, node);

    if (references.length > 0 && !force) {
        return preview(
            `'${node}' is referenced by ${count(references.length, "property")}; deleting it would clear ${references.length === 1 ? "that reference" : "those references"}. Re-run with --force.`,
            {
                node_count: 1,
                property_count: references.length,
                paths: [[node], ...references.map(reference => [reference.owner, reference.property])]
            },
            `${node}: referenced by\n\n`
            + references.map(reference => `  ${reference.owner}.${reference.property}\n`).join("")
            + "\nNothing was changed. Re-run with --force to delete the node and clear those references."
        );
    }

    const referenced_before = referenced_nodes(context.workfile);
    for (const reference of references) {
        const cleared = clear_reference(context.workfile, reference, node);
        if (!cleared.ok) {
            return refuse(
                `Cannot delete '${node}': ${reference.owner}.${reference.property} references it and could not be `
                + `cleared (${cleared.error.message}). Delete '${reference.owner}' instead.`
            );
        }
    }

    const removed = remove_symbol(context.workfile, node);
    if (!removed.ok) {
        return refuse(removed.error.message);
    }

    const message = references.length > 0
        ? `Deleted '${node}' and cleared ${count(references.length, "reference")} to it`
        : `Deleted '${node}'`;
    const bootstrapped = write(context, message, program, referenced_before);
    if (!Array.isArray(bootstrapped)) {
        return bootstrapped;
    }
    return answer(common_ok(message), [message, ...bootstrapped].join("\n"));
}

function delete_everything(context: WorkfileContext, force: boolean, program: string): Outcome<DeleteResponse> {
    const names = Object.keys(context.workfile.symbols);

    if (names.length === 0) {
        const message = "Nothing to delete: the workfile has no nodes";
        return answer(common_ok(message), message);
    }

    if (!force) {
        return preview(
            `Deleting the root removes every node in the workfile (${count(names.length, "node")}). Re-run with --force.`,
            {
                node_count: names.length,
                property_count: property_count(context.workfile),
                paths: names.map(name => [name])
            },
            `${root_key(context)}: would delete ${count(names.length, "node")}\n\n`
            + names.map(name => `  ${name}\n`).join("")
            + "\nNothing was changed. Re-run with --force to delete them all."
        );
    }

    for (const name of names) {
        const removed = remove_symbol(context.workfile, name);
        if (!removed.ok) {
            return refuse(removed.error.message);
        }
    }

    // Nothing is left for bootstrap to build on.
    const written = write(context, "Deleted everything", program);
    if (!Array.isArray(written)) {
        return written;
    }

    const message = `Deleted ${count(names.length, "node")}`;
    return answer(common_ok(message), message);
}

// ------- HELPERS --------

/**
 * Bootstrap (when given what was referenced before the change) and save. The lines
 * describing what bootstrap did, or the refusal when either failed.
 */
function write(context: WorkfileContext, message: string, program: string, referenced_before?: Set<string>): string[] | Outcome<never> {
    const ran = referenced_before === undefined ? undefined : run_bootstrap(context.workfile, referenced_before);
    if (ran?.ok === false) {
        return refuse(`${message}, but bootstrap failed: ${ran.error.message}`);
    }

    const saved = save_workfile(context);
    if (!saved.ok) {
        return refuse(saved.error.message);
    }

    return ran?.value === undefined ? [] : describe_bootstrap(ran.value, context.workfile, program);
}

/**
 * A refused delete: what *would* go, with nothing written.
 *
 * `ok: true` on purpose: being asked to confirm is not a failure, and the counts are the
 * answer to the question asked.
 */
function preview(
    message: string,
    counts: Pick<DeletePreview, "node_count" | "property_count" | "paths">,
    text: string
): Outcome<DeleteResponse> {
    const response: DeletePreview = { ...common_ok(message, "warn"), ...counts };
    return answer(response, text);
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

    // Cleared, not merely unset: the user deleted what it named, so bootstrap must not build
    // it straight back.
    return clear_value(workfile, reference.owner, reference.property);
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
    return `${String(amount)} ${noun}${amount === 1 ? "" : "s"}`;
}
