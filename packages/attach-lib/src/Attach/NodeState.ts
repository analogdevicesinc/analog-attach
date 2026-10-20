/**
 * Properties whose value decides another one's shape, so they are asked
 * first: `interrupts` takes as many cells as `interrupt-parent`'s
 * `#interrupt-cells`.
 */
export const PROPERTY_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
    interrupts: ["interrupt-parent"],
};

/**
 * The required properties a node doesn't have yet, in binding order, each
 * right after the dependencies it lacks (see PROPERTY_DEPENDENCIES). A
 * dependency is asked even when the binding doesn't require it, and only
 * when it isn't set on the node itself: an inherited one is a suggestion,
 * not an answer.
 */
export function missing_required(required: readonly string[], present: Iterable<string>): string[] {
    const set = new Set(present);
    const missing: string[] = [];
    const add = (name: string): void => {
        if (!set.has(name) && !missing.includes(name)) { missing.push(name); }
    };
    for (const name of required) {
        if (set.has(name)) { continue; }
        for (const dependency of PROPERTY_DEPENDENCIES[name] ?? []) { add(dependency); }
        add(name);
    }
    return missing;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("missing_required — binding order, set ones skipped", () => {
        expect(missing_required(["compatible", "reg", "spi-max-frequency"], ["compatible"])).toEqual(["reg", "spi-max-frequency"]);
        expect(missing_required(["compatible", "reg"], ["compatible", "reg"])).toEqual([]);
    });

    test("missing_required — interrupt-parent is asked right before interrupts", () => {
        expect(missing_required(["compatible", "reg", "interrupts", "spi-max-frequency"], []))
            .toEqual(["compatible", "reg", "interrupt-parent", "interrupts", "spi-max-frequency"]);
    });

    test("missing_required — a dependency set on the node is not asked", () => {
        expect(missing_required(["compatible", "interrupts"], ["compatible", "interrupt-parent"])).toEqual(["interrupts"]);
    });

    test("missing_required — a set dependent doesn't pull in its dependency", () => {
        expect(missing_required(["compatible", "interrupts"], ["compatible", "interrupts"])).toEqual([]);
    });

    test("missing_required — a dependency the binding also requires is asked once, at the first place", () => {
        expect(missing_required(["interrupts", "interrupt-parent"], [])).toEqual(["interrupt-parent", "interrupts"]);
    });
}
