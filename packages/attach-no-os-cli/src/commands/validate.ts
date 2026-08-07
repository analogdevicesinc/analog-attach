import { buildCommand } from "@stricli/core";
import {
    validate_workfile,
    ValidationError
} from "attach-no-os-lib";
import type { AttachContext } from "./shared";
import {
    load_context,
    output,
    output_error,
    get_node,
    get_node_property
} from "./shared";
import {
    prior_positionals,
    filter_completions,
    get_node_names,
    get_property_names
} from "../completion/completion";

export const validateCommand = buildCommand<
    { json?: boolean },
    [string | undefined, string | undefined],
    AttachContext
>({
    docs: { brief: "Validate workfile, node, or property" },
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
                    placeholder: "property", brief: "Property name", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        const [node] = prior_positionals(this, 1);
                        return filter_completions(get_property_names(node), partial);
                    }
                }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async function (flags, node, property) {
        const context = load_context(this.workfile_path);
        if (!context.ok) {
            output_error(flags, "load_failed", context.error.message);
            return;
        }

        const validation_result = validate_workfile(context.value.workfile);

        // aa validate - validate entire workfile
        if (!node) {
            const node_count = Object.keys(context.value.workfile.symbols).length;
            const error_count = validation_result.errors.filter(error => error.severity === "error").length;
            const warning_count = validation_result.errors.filter(error => error.severity === "warning").length;

            const text = format_workfile_validation(validation_result.errors, node_count, error_count, warning_count);
            const json = {
                valid: validation_result.valid,
                summary: {
                    nodes: node_count,
                    errors: error_count,
                    warnings: warning_count
                },
                errors: validation_result.errors
            };
            output(flags, text, json);
            return;
        }

        // Check node exists
        const node_result = get_node(context.value, node);
        if (!node_result.ok) {
            output_error(flags, "node_not_found", node_result.error.message);
            return;
        }

        // Filter errors for this node
        const node_errors = validation_result.errors.filter(error => error.path.startsWith(node + ".") || error.path === node);

        // aa validate <node> - validate specific node
        if (!property) {
            const error_count = node_errors.filter(error => error.severity === "error").length;
            const warning_count = node_errors.filter(error => error.severity === "warning").length;

            const text = format_node_validation(node, node_result.value.properties.map(property => property.name), node_errors, error_count, warning_count);
            const json = {
                valid: error_count === 0,
                node,
                summary: {
                    properties: node_result.value.properties.length,
                    errors: error_count,
                    warnings: warning_count
                },
                errors: node_errors
            };
            output(flags, text, json);
            return;
        }

        // Check property exists
        const lookup = get_node_property(context.value, node, property);
        if (!lookup.ok) {
            output_error(flags, "property_not_found", lookup.error.message);
            return;
        }

        // Filter errors for this property
        const property_path = `${node}.${property}`;
        const property_errors = validation_result.errors.filter(error => error.path.startsWith(property_path));

        // aa validate <node> <property> - validate specific property
        const error_count = property_errors.filter(error => error.severity === "error").length;
        const warning_count = property_errors.filter(error => error.severity === "warning").length;

        const text = format_property_validation(
            property_path,
            lookup.value.property.value,
            property_errors,
            error_count,
            warning_count
        );
        const json = {
            valid: error_count === 0,
            path: property_path,
            value: lookup.value.property.value,
            summary: {
                errors: error_count,
                warnings: warning_count
            },
            errors: property_errors
        };
        output(flags, text, json);
    }
});

// ------- FORMATTERS --------

function format_workfile_validation(
    errors: ValidationError[],
    node_count: number,
    error_count: number,
    warning_count: number
): string {
    if (error_count === 0 && warning_count === 0) {
        let out = "✓ Workfile is valid\n\n";
        out += `  ${node_count} nodes checked\n`;
        out += `  0 errors, 0 warnings`;
        return out;
    }

    let out = "✗ Workfile has errors\n\n";

    const grouped = group_errors_by_node(errors);
    for (const [node_name, node_errors] of Object.entries(grouped)) {
        out += `  ${node_name}\n`;
        for (const error of node_errors) {
            const property_name = error.path.includes(".") ? error.path.split(".").slice(1).join(".") : error.path;
            const marker = error.severity === "error" ? "✗" : "⚠";
            out += `    ${marker} ${property_name}: ${error.message}\n`;
        }
        out += "\n";
    }

    out += `  ${error_count} error${error_count === 1 ? "" : "s"}, ${warning_count} warning${warning_count === 1 ? "" : "s"}`;
    return out;
}

function format_node_validation(
    node_name: string,
    property_names: string[],
    errors: ValidationError[],
    error_count: number,
    warning_count: number
): string {
    const valid = error_count === 0;
    const marker = valid ? "✓" : "✗";
    let out = `${marker} ${node_name}${valid ? " is valid" : " has errors"}\n\n`;

    const errors_by_property = new Map<string, ValidationError[]>();
    for (const error of errors) {
        const property_name = error.path.includes(".") ? error.path.split(".")[1] : "(node)";
        if (!errors_by_property.has(property_name)) {
            errors_by_property.set(property_name, []);
        }
        errors_by_property.get(property_name)!.push(error);
    }

    for (const property_name of property_names) {
        const property_errors = errors_by_property.get(property_name);
        if (property_errors && property_errors.length > 0) {
            for (const error of property_errors) {
                const error_marker = error.severity === "error" ? "✗" : "⚠";
                out += `  ${error_marker} ${property_name}: ${error.message}\n`;
            }
        } else {
            out += `  ✓ ${property_name}\n`;
        }
    }

    out += `\n  ${error_count} error${error_count === 1 ? "" : "s"}, ${warning_count} warning${warning_count === 1 ? "" : "s"}`;
    return out;
}

function format_property_validation(
    path: string,
    value: unknown,
    errors: ValidationError[],
    error_count: number,
    warning_count: number
): string {
    const valid = error_count === 0;
    const marker = valid ? "✓" : "✗";
    let out = `${marker} ${path}${valid ? " is valid" : " has errors"}\n\n`;

    out += `  Value: ${value === undefined ? "(not set)" : JSON.stringify(value)}\n`;

    if (errors.length > 0) {
        out += "\n";
        for (const error of errors) {
            const error_marker = error.severity === "error" ? "✗" : "⚠";
            out += `  ${error_marker} ${error.message}\n`;
        }
    }

    out += `\n  ${error_count} error${error_count === 1 ? "" : "s"}, ${warning_count} warning${warning_count === 1 ? "" : "s"}`;
    return out;
}

function group_errors_by_node(errors: ValidationError[]): Record<string, ValidationError[]> {
    const grouped: Record<string, ValidationError[]> = {};
    for (const error of errors) {
        const node_name = error.path.split(".")[0];
        if (!grouped[node_name]) {
            grouped[node_name] = [];
        }
        grouped[node_name].push(error);
    }
    return grouped;
}
