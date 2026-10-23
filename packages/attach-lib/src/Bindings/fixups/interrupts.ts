import { NodeFixup } from "../FixupWalker.js";

/** Conditions only match: what the fixup adds to a node must not become something they require. */
const CONDITION_KEYS = new Set(["if", "not", "select"]);

/**
 * dt-schema: `fixups.py:fixup_interrupts`. A node with `interrupts` (or that is an interrupt controller)
 * can have an `interrupt-parent`. dt-schema adds it as `true`; ours is typed, as one phandle.
 *
 * Not ported: `interrupts-extended` (a copy of `interrupts`), and the rewrite of a required `interrupts`
 * into "`interrupts` or `interrupts-extended`". They'd show up as properties and change what is required.
 */
export const fixup_interrupts: NodeFixup = (schema, path) => {
    const properties = schema["properties"];

    if (typeof properties !== "object" || properties === null || path.some(key => CONDITION_KEYS.has(key))) { return; }

    const declared = properties as Record<string, unknown>;

    if (("interrupts" in declared || "interrupt-controller" in declared) && !("interrupt-parent" in declared)) {
        declared["interrupt-parent"] = { minItems: 1, maxItems: 1, type: "array" };
    }
};

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const fixup = (schema: Record<string, unknown>, path: string[] = []) => {
        fixup_interrupts(schema, path);
        return schema;
    };
    const interrupt_parent = { minItems: 1, maxItems: 1, type: "array" };

    test("a node with interrupts or that is an interrupt controller gets an interrupt-parent", () => {
        const interrupts = { minItems: 1, maxItems: 1, type: "array" };
        expect(fixup({ properties: { compatible: { enum: ["one"] }, interrupts } })).toStrictEqual({
            properties: { compatible: { enum: ["one"] }, interrupts, "interrupt-parent": interrupt_parent },
        });
        expect(fixup({ properties: { "interrupt-controller": true } })).toStrictEqual({
            properties: { "interrupt-controller": true, "interrupt-parent": interrupt_parent },
        });
    });

    test("an interrupt-parent the binding has stays as it is", () => {
        const existing = { type: "array", minItems: 1 };
        expect(fixup({ properties: { interrupts: true, "interrupt-parent": existing } })).toStrictEqual({
            properties: { interrupts: true, "interrupt-parent": existing },
        });
    });

    test("other nodes, and conditions, are left alone", () => {
        expect(fixup({ properties: { compatible: true } })).toStrictEqual({ properties: { compatible: true } });
        expect(fixup({ type: "object" })).toStrictEqual({ type: "object" });
        expect(fixup({ properties: { interrupts: true } }, ["allOf", "if"])).toStrictEqual({ properties: { interrupts: true } });
    });
}
