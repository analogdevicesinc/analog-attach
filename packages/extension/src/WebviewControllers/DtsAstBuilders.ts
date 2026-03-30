/**
 * DTS AST Builder Helpers
 *
 * Reusable helper functions for constructing attach-lib AST structures.
 * These helpers eliminate boilerplate and ensure consistent handling of
 * edge cases (labels: [], deleted: false, etc.).
 *
 * Designed to be backend-agnostic so they can later be moved to attach-lib.
 */
import type { DtsValueComponent, DtsProperty, DtsNode, CellArrayElement } from "attach-lib";

// ========== VALUE COMPONENT BUILDERS ==========

/**
 * Create a string component: kind: "string"
 */
export function dtsString(value: string): DtsValueComponent {
    return {
        kind: "string",
        value,
        labels: [],
    };
}

/**
 * Create a numeric array component: kind: "array" with a single number element.
 */
export function dtsNumber(value: number | bigint, repr: "hex" | "dec" = "dec"): DtsValueComponent {
    return {
        kind: "array",
        elements: [{
            item: {
                kind: "number",
                value: typeof value === "bigint" ? value : BigInt(Math.trunc(value)),
                repr,
                labels: [],
            },
        }],
        labels: [],
    };
}

/**
 * Create a label reference: kind: "ref", ref: { kind: "label" }
 */
export function dtsLabelRef(label: string): DtsValueComponent {
    const name = label.startsWith("&") ? label.slice(1) : label;
    return {
        kind: "ref",
        ref: { kind: "label", name },
        labels: [],
    };
}

/**
 * Create a path reference: kind: "ref", ref: { kind: "path" }
 */
export function dtsPathRef(path: string): DtsValueComponent {
    return {
        kind: "ref",
        ref: { kind: "path", path },
        labels: [],
    };
}

/**
 * Create a cell array component: kind: "array" with provided elements.
 */
export function dtsCellArray(elements: CellArrayElement[]): DtsValueComponent {
    return {
        kind: "array",
        elements,
        labels: [],
    };
}

/**
 * Smart value-to-component conversion:
 * - number/bigint → dtsNumber
 * - string starting with "&" → dtsLabelRef
 * - string starting with "/" → dtsPathRef
 * - other string → dtsString
 * - array → dtsCellArray with dtsCellElement for each
 * - true → undefined (flag property, no value)
 */
export function dtsValueComponent(
    value: unknown,
    options?: { numberFormat?: "hex" | "dec" }
): DtsValueComponent | undefined {
    if (value === true) {
        return undefined; // Flag property - no value
    }

    if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "bigint") {
        return dtsNumber(value, options?.numberFormat ?? "dec");
    }

    if (typeof value === "string") {
        if (value.startsWith("&")) {
            return dtsLabelRef(value);
        }
        if (value.startsWith("/")) {
            return dtsPathRef(value);
        }
        return dtsString(value);
    }

    if (Array.isArray(value)) {
        const elements: CellArrayElement[] = [];
        for (const entry of value) {
            const element = dtsCellElement(entry, options);
            if (element) {
                elements.push(element);
            }
        }
        if (elements.length === 0) {
            return undefined;
        }
        return dtsCellArray(elements);
    }

    return undefined;
}

// ========== CELL ARRAY ELEMENT BUILDERS ==========

/**
 * Create a number element.
 */
export function dtsNumberElement(value: number | bigint, repr: "hex" | "dec" = "dec"): CellArrayElement {
    return {
        item: {
            kind: "number",
            value: typeof value === "bigint" ? value : BigInt(Math.trunc(value)),
            repr,
            labels: [],
        },
    };
}

/**
 * Create a reference element (inside an array).
 */
export function dtsRefElement(ref: string): CellArrayElement {
    const isPath = ref.startsWith("/");
    const isLabel = ref.startsWith("&");
    const name = isLabel ? ref.slice(1) : ref;

    return {
        item: {
            kind: "ref",
            ref: isPath
                ? { kind: "path", path: ref }
                : { kind: "label", name },
            labels: [],
        },
    };
}

/**
 * Create an expression element.
 */
export function dtsExpressionElement(value: string): CellArrayElement {
    return {
        item: {
            kind: "expression",
            value,
            labels: [],
        },
    };
}

/**
 * Create a macro element.
 */
export function dtsMacroElement(value: string): CellArrayElement {
    return {
        item: {
            kind: "macro",
            value,
            labels: [],
        },
    };
}

/**
 * Smart value-to-element conversion:
 * - number/bigint → dtsNumberElement
 * - hex string (0x...) → dtsNumberElement with hex repr
 * - decimal string → dtsNumberElement with dec repr
 * - "&label" or "/path" → dtsRefElement
 * - with enumType "phandle" → dtsRefElement
 * - with enumType "macro" → dtsMacroElement
 * - other string → dtsExpressionElement
 */
export function dtsCellElement(
    value: unknown,
    options?: { numberFormat?: "hex" | "dec"; enumType?: "phandle" | "macro" | "string" }
): CellArrayElement | undefined {
    if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "bigint") {
        return dtsNumberElement(value, options?.numberFormat ?? "dec");
    }

    if (typeof value === "string") {
        // Handle enumType-specific conversions
        if (options?.enumType === "phandle") {
            const isPath = value.startsWith("/");
            return {
                item: {
                    kind: "ref",
                    ref: isPath
                        ? { kind: "path", path: value }
                        : { kind: "label", name: value },
                    labels: [],
                },
            };
        }

        if (options?.enumType === "macro") {
            // Empty macro defaults to 0
            if (!value) {
                return dtsNumberElement(0n, "dec");
            }
            return dtsMacroElement(value);
        }

        // Hex string
        if (/^0x[0-9a-f]+$/i.test(value)) {
            const parsed = Number.parseInt(value, 16);
            if (Number.isFinite(parsed)) {
                return dtsNumberElement(BigInt(parsed), "hex");
            }
        }

        // Decimal string
        if (/^[+-]?\d+$/.test(value)) {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
                return dtsNumberElement(BigInt(parsed), "dec");
            }
        }

        // Phandle reference
        if (value.startsWith("&") || value.startsWith("/")) {
            return dtsRefElement(value);
        }

        // Expression/macro fallback
        return dtsExpressionElement(value);
    }

    return undefined;
}

// ========== PROPERTY BUILDERS ==========

/**
 * Create a DtsProperty with value components.
 */
export function dtsProperty(name: string, ...components: DtsValueComponent[]): DtsProperty {
    return {
        name,
        value: components.length > 0 ? { components } : undefined,
        modified_by_user: true,
        labels: [],
        deleted: false,
    };
}

/**
 * Create a flag property (no value, presence indicates true).
 */
export function dtsFlagProperty(name: string): DtsProperty {
    return {
        name,
        modified_by_user: true,
        labels: [],
        deleted: false,
    };
}

/**
 * Create a string property (shorthand).
 */
export function dtsStringProperty(name: string, value: string): DtsProperty {
    return dtsProperty(name, dtsString(value));
}

/**
 * Create a status property.
 */
export function dtsStatusProperty(active: boolean): DtsProperty {
    const statusValue = active ? "okay" : "disabled";
    return dtsStringProperty("status", statusValue);
}

// ========== NODE BUILDERS ==========

/**
 * Create a new DtsNode with minimal required fields.
 */
export function dtsNode(options: {
    name: string;
    unitAddr?: string;
    labels?: string[];
    properties?: DtsProperty[];
    children?: DtsNode[];
    createdByUser?: boolean;
}): DtsNode {
    return {
        name: options.name,
        unit_addr: options.unitAddr,
        _uuid: crypto.randomUUID(),
        labels: options.labels ?? [],
        properties: options.properties ?? [],
        children: options.children ?? [],
        modified_by_user: true,
        created_by_user: options.createdByUser ?? true,
        deleted: false,
    };
}
