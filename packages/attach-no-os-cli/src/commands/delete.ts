import { buildCommand } from "@stricli/core";
import {
    export_minimal,
    get_symbol,
    import_minimal,
    list_symbols,
    load_minimal_workfile,
    MinimalWorkfile,
    remove_symbol,
    resolve_workfile_path,
    set_value
} from "attach-no-os-lib";
import fs from "node:fs";

export const deleteCommand = buildCommand<
{ json?: boolean; reset?: string },
[string | undefined]  // node
>({
    docs: { brief: "Delete a node or reset a property" },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                { placeholder: "node", brief: "Node name", optional: true, parse: String }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            reset: { kind: "parsed", brief: "Property to reset", optional: true, parse: String }
        }
    },
    func: async (flags, node) => {
        const workfile_path = resolve_workfile_path();
        if (!workfile_path) {
            const message = "No workfile found in current directory";
            if (flags.json) {
                console.log(JSON.stringify({ error: "no_workfile", message }));
            } else {
                console.log(message);
            }
            return;
        }

        const minimal = load_minimal_workfile(workfile_path);
        if (!minimal.ok) {
            if (flags.json) {
                console.log(JSON.stringify({ error: "load_failed", message: minimal.error.message }));
            } else {
                console.log(minimal.error.message);
            }
            return;
        }

        // aa delete - list deletable nodes
        if (!node) {
            if (flags.json) {
                console.log(JSON.stringify({
                    nodes: Object.entries(minimal.value.symbols).map(([name, n]) => ({
                        name,
                        schema: n.$compatible
                    }))
                }, undefined, 2));
            } else {
                console.log(format_deletable_nodes(minimal.value));
            }
            return;
        }

        const workfile = import_minimal(minimal.value);
        if (!workfile.ok) {
            if (flags.json) {
                console.log(JSON.stringify({ error: "import_failed", message: workfile.error.message }));
            } else {
                console.log(workfile.error.message);
            }
            return;
        }

        // Check node exists
        const symbol = get_symbol(workfile.value, node);
        if (!symbol.ok) {
            if (flags.json) {
                console.log(JSON.stringify({
                    error: "node_not_found",
                    node: node,
                    existing_nodes: list_symbols(workfile.value)
                }, undefined, 2));
            } else {
                console.log(`Node '${node}' not found.\n`);
                console.log(format_existing_nodes(minimal.value));
            }
            return;
        }

        // aa delete <node> --reset <property>
        if (flags.reset) {
            const result = set_value(workfile.value, node, flags.reset);
            if (!result.ok) {
                if (flags.json) {
                    console.log(JSON.stringify({ error: "reset_failed", message: result.error.message }));
                } else {
                    console.log(result.error.message);
                }
                return;
            }

            const updated = export_minimal(workfile.value);
            if (!updated.ok) {
                if (flags.json) {
                    console.log(JSON.stringify({ error: "export_failed", message: updated.error.message }));
                } else {
                    console.log(updated.error.message);
                }
                return;
            }

            fs.writeFileSync(workfile_path, JSON.stringify(updated.value, undefined, 2));

            if (flags.json) {
                console.log(JSON.stringify({
                    reset: { node, property: flags.reset }
                }, undefined, 2));
            } else {
                console.log(`Reset ${node}.${flags.reset}`);
            }
            return;
        }

        // aa delete <node>
        const result = remove_symbol(workfile.value, node);
        if (!result.ok) {
            if (flags.json) {
                console.log(JSON.stringify({ error: "delete_failed", message: result.error.message }));
            } else {
                console.log(result.error.message);
            }
            return;
        }

        const updated = export_minimal(workfile.value);
        if (!updated.ok) {
            if (flags.json) {
                console.log(JSON.stringify({ error: "export_failed", message: updated.error.message }));
            } else {
                console.log(updated.error.message);
            }
            return;
        }

        fs.writeFileSync(workfile_path, JSON.stringify(updated.value, undefined, 2));

        if (flags.json) {
            console.log(JSON.stringify({ deleted: node }, undefined, 2));
        } else {
            console.log(`Deleted node ${node}`);
        }
    }
});

// ------ FORMATTERS -------

function format_deletable_nodes(minimal: MinimalWorkfile): string {
    const entries = Object.entries(minimal.symbols);

    if (entries.length === 0) {
        return "No nodes to delete.";
    }

    let out = "Nodes that can be deleted:\n\n";
    for (const [name, node] of entries) {
        out += `  ${name.padEnd(18)}${node.$compatible}\n`;
    }
    out += "\nUse: aa delete <node>";
    return out;
}

function format_existing_nodes(minimal: MinimalWorkfile): string {
    const names = Object.keys(minimal.symbols);
    if (names.length === 0) {
        return "No existing nodes.";
    }
    return "Existing nodes:\n" + names.map(n => `  ${n}`).join("\n");
}
