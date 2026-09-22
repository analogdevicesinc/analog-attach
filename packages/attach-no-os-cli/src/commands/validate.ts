import { buildCommand } from "@stricli/core";
import { validate_workfile, ValidationError } from "attach-no-os-lib";
import type { AttachContext } from "./shared";
import { load_context, output, output_error } from "./shared";
import {
    validation_failure,
    type ValidationError as ProtocolError,
    type ValidationResponse
} from "../protocol/responses";

/**
 * `attach-noos validate` — check the whole workfile.
 *
 * Always the whole workfile, and never a path: the protocol calls this with no arguments and
 * narrows the findings itself by matching their paths, so scoping here would only hide
 * findings from it. The human report groups by node, which is the same information a
 * per-node run used to print.
 */
export const validateCommand = buildCommand<{ json?: boolean }, [], AttachContext>({
    docs: {
        brief: "Validate the workfile",
        fullDescription: "Checks every node against its schema and reports what is missing or inconsistent."
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message, { response: validation_failure(context.error.message) });
            return;
        }

        const result = validate_workfile(context.value.workfile);
        const errors = result.errors.filter(finding => finding.severity === "error");
        const warnings = result.errors.filter(finding => finding.severity === "warning");

        const response: ValidationResponse = {
            errors: errors.map(to_protocol_error),
            warnings: warnings.map(to_protocol_error)
        };

        // A workfile with errors is a valid answer to "is it valid", not a failed run, so
        // this reports through `output` — but a human still wants a non-zero status.
        if (!flags.json && errors.length > 0) {
            process.exitCode = 1;
        }

        output(
            flags,
            format_validation(
                result.errors,
                Object.keys(context.value.workfile.symbols).length,
                errors.length,
                warnings.length
            ),
            response
        );
    }
});

/**
 * `node.property` → `["node", "property"]`.
 *
 * An empty path is the workfile as a whole, which attach-meta passes through whatever it was
 * asked about — the right behaviour for a finding that belongs to no node.
 */
function to_protocol_error(finding: ValidationError): ProtocolError {
    return {
        kind: "generic",
        path: finding.path.split(".").filter(segment => segment.length > 0),
        message: finding.message
    };
}

// ------- FORMATTERS --------

function format_validation(
    findings: ValidationError[],
    node_count: number,
    error_count: number,
    warning_count: number
): string {
    const summary = `  ${count(error_count, "error")}, ${count(warning_count, "warning")}`;

    if (findings.length === 0) {
        return `✓ Workfile is valid\n\n  ${count(node_count, "node")} checked\n${summary}`;
    }

    let out = error_count > 0 ? "✗ Workfile has errors\n\n" : "⚠ Workfile has warnings\n\n";

    for (const [node, node_findings] of group_by_node(findings)) {
        out += `  ${node}\n`;
        for (const finding of node_findings) {
            const property = finding.path.includes(".")
                ? finding.path.split(".").slice(1).join(".")
                : finding.path;
            const marker = finding.severity === "error" ? "✗" : "⚠";
            out += `    ${marker} ${property}: ${finding.message}\n`;
        }
        out += "\n";
    }

    return out + summary;
}

function group_by_node(findings: ValidationError[]): Map<string, ValidationError[]> {
    const grouped = new Map<string, ValidationError[]>();

    for (const finding of findings) {
        const node = finding.path.split(".")[0] || "(workfile)";
        grouped.set(node, [...grouped.get(node) ?? [], finding]);
    }

    return grouped;
}

function count(amount: number, noun: string): string {
    return `${amount} ${noun}${amount === 1 ? "" : "s"}`;
}
