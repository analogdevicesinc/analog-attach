import { validate_workfile, type ValidationError } from "attach-no-os-lib";
import { answer, command, refuse, type ValidateArguments } from "../../../interface/backend-interface";
import { load_context } from "./shared";
import type { ValidationFinding, ValidationResponse } from "../protocol/responses";

/**
 * `validate`: check the whole workfile.
 *
 * Always the whole workfile, and never a path: a caller narrows the findings itself by
 * matching their paths, so scoping here would only hide findings from it. The human report
 * groups by node, which is the same information a per-node run used to print.
 */
export const validate = command<ValidateArguments, ValidationResponse>({
    docs: {
        brief: "Validate the workfile",
        full: "Checks every node against its schema and reports what is missing or inconsistent."
    },
    run(_arguments, _flags, session) {
        const context = load_context(session);
        if (!context.ok) {
            return Promise.resolve(refuse(context.error.message));
        }

        const result = validate_workfile(context.value.workfile);
        const errors = result.errors.filter(finding => finding.severity === "error");
        const warnings = result.errors.filter(finding => finding.severity === "warning");

        const response: ValidationResponse = {
            errors: errors.map(finding => to_protocol_error(finding)),
            warnings: warnings.map(finding => to_protocol_error(finding))
        };

        // A workfile with errors is a valid answer to "is it valid", not a failed run: exit 0,
        // with the errors in what is printed.
        const text = format_validation(
            result.errors,
            Object.keys(context.value.workfile.symbols).length,
            errors.length,
            warnings.length
        );
        return Promise.resolve(answer(response, text));
    }
});

/**
 * `node.property` → `["node", "property"]`.
 *
 * An empty path is the workfile as a whole: a finding that belongs to no node.
 */
function to_protocol_error(finding: ValidationError): ValidationFinding {
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
        const [first = ""] = finding.path.split(".");
        const node = first === "" ? "(workfile)" : first;
        grouped.set(node, [...grouped.get(node) ?? [], finding]);
    }

    return grouped;
}

function count(amount: number, noun: string): string {
    return `${String(amount)} ${noun}${amount === 1 ? "" : "s"}`;
}
