import { DeviceTree } from "./Devicetree.js";
import { DeviceTreeOverlay } from "./DevicetreeOverlay.js";
import { type DTLabel, type DTNode, type DTPath, get_full_node_name, is_dt_flag } from "./Parser/AST.js";

/** A phandle or path reference in the overlay that names nothing in the base tree or the overlay. */
export interface UnresolvedReference {
    /** Absolute path of the node holding the property (the fragment's target text when that doesn't resolve). */
    path: string;
    property: string;
    /** As written: `&label` or `&{/path}`. */
    reference: string;
}

/** A fragment whose `target` / `target-path` names no node that exists before the fragment is applied. */
export interface UnresolvedTarget {
    fragment: number;
    /** As written: `&label` or the target path. */
    target: string;
}

/**
 * The references in the overlay's properties (`<&label …>`, `= &label`,
 * `&{/path}`) that resolve to no node of the base tree or the overlay, in
 * tree order. With `under`, only nodes at or below that absolute path.
 */
export function unresolved_references(overlay: DeviceTreeOverlay, under?: string): UnresolvedReference[] {
    const labels = overlay.all_labels();
    const exists: Exists = path => overlay.effective_node(path) !== undefined;
    const resolves = (value: DTLabel | DTPath): boolean =>
        locate(labels, exists, value.kind === "label" ? strip_ampersand(value.name) : value.path) !== undefined;
    const inside = (path: string): boolean => under === undefined || path === under || path.startsWith(`${under}/`);

    const found: UnresolvedReference[] = [];
    const walk = (node: DTNode, path: string): void => {
        if (inside(path)) {
            for (const property of node.properties) {
                if (is_dt_flag(property.value)) { continue; }
                for (const value of property.value) {
                    for (const element of value.kind === "array" ? value.elements : [value]) {
                        if (is_reference(element) && !resolves(element)) {
                            found.push({ path, property: property.name, reference: written(element) });
                        }
                    }
                }
            }
        }
        for (const child of node.children) { walk(child, join_path(path, get_full_node_name(child))); }
    };

    for (const fragment of overlay.get_fragments()) {
        const body = fragment_body(fragment);
        if (body === undefined) { continue; }
        walk(body, target_root(labels, exists, fragment) ?? fragment_target_text(fragment) ?? "");
    }
    return found;
}

/**
 * The fragments whose `target` label or `target-path` names no node of the
 * base tree or the overlay. A fragment's own `__overlay__` doesn't count: the
 * target must exist before the fragment is applied.
 */
export function unresolved_targets(overlay: DeviceTreeOverlay): UnresolvedTarget[] {
    const labels = overlay.all_labels();
    const below_fragments = overlay_paths(overlay);
    const base = overlay.get_base_dts();
    const exists: Exists = path => base?.node_exists(path) === true || below_fragments.has(path);
    return overlay.get_fragments().flatMap((fragment, index) => {
        if (target_root(labels, exists, fragment) !== undefined) { return []; }
        return [{ fragment: index, target: fragment_target_text(fragment) ?? "" }];
    });
}

type Exists = (path: string) => boolean;

/** The fragment's target as an absolute path, when that node exists. */
function target_root(labels: Map<string, string>, exists: Exists, fragment: DTNode): string | undefined {
    const target = fragment_target_text(fragment);
    if (target === undefined) { return undefined; }
    return locate(labels, exists, strip_ampersand(target));
}

/** The absolute path of `label`, `/path` or `label/child`, when that node exists. */
function locate(labels: Map<string, string>, exists: Exists, reference: string): string | undefined {
    if (reference.startsWith("/")) { return exists(reference) ? reference : undefined; }
    const [label = "", ...rest] = reference.split("/");
    const root = labels.get(label);
    if (root === undefined || rest.length === 0) { return root; }
    const path = join_path(root, rest.join("/"));
    return exists(path) ? path : undefined;
}

/** The fragment's `__overlay__`, or its `__dormant__` when `__overrides__` may switch it on. */
function fragment_body(fragment: DTNode): DTNode | undefined {
    return fragment.children.find(child => child.name === "__overlay__" || child.name === "__dormant__");
}

/** The paths of the nodes below each fragment's body (not the fragment roots). */
function overlay_paths(overlay: DeviceTreeOverlay): Set<string> {
    const paths = new Set<string>();
    const collect = (node: DTNode, path: string): void => {
        for (const child of node.children) {
            const child_path = join_path(path, get_full_node_name(child));
            paths.add(child_path);
            collect(child, child_path);
        }
    };
    for (const fragment of overlay.get_fragments()) {
        const body = fragment_body(fragment);
        if (body !== undefined) { collect(body, overlay.get_fragment_root_path(fragment) ?? ""); }
    }
    return paths;
}

/** The fragment's target as written: `&label`, or the path of `target-path` / `<&{/path}>`. */
function fragment_target_text(fragment: DTNode): string | undefined {
    for (const name of ["target", "target-path"]) {
        const property = fragment.properties.find(p => p.name === name);
        if (property === undefined || is_dt_flag(property.value)) { continue; }
        for (const value of property.value) {
            if (value.kind === "string") { return value.value; }
            const element = value.kind === "array" ? value.elements[0] : undefined;
            if (element?.kind === "label") { return `&${strip_ampersand(element.name)}`; }
            if (element?.kind === "path") { return element.path; }
        }
    }
    return undefined;
}

function is_reference(value: { kind: string }): value is DTLabel | DTPath {
    return value.kind === "label" || value.kind === "path";
}

function written(reference: DTLabel | DTPath): string {
    return reference.kind === "label" ? `&${strip_ampersand(reference.name)}` : `&{${reference.path}}`;
}

function strip_ampersand(name: string): string {
    return name.startsWith("&") ? name.slice(1) : name;
}

function join_path(parent: string, child: string): string {
    return parent === "/" || parent === "" ? `/${child}` : `${parent}/${child}`;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base_source = `/dts-v1/;
/ {
    soc {
        gpio: gpio@7e200000 { gpio-controller; #gpio-cells = <2>; };
        spi0: spi@7e204000 { #address-cells = <1>; #size-cells = <0>; };
    };
};`;

    const setup = (overlay_source: string): DeviceTreeOverlay => {
        const base = DeviceTree.new_from_string(base_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n${overlay_source}`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return overlay;
    };

    test("unresolved_references — labels from the base and the overlay resolve; others are reported", () => {
        const overlay = setup(`&spi0 {
    adc: adc@0 {
        reg = <0>;
        reset-gpios = <&gpio 26 0>;
        interrupt-parent = <&gpio_expander>;
        clocks = <&adc_clk>, <&ref 1>;
    };
    adc_clk: clk { #clock-cells = <0>; };
};`);
        expect(unresolved_references(overlay)).toEqual([
            { path: "/soc/spi@7e204000/adc@0", property: "interrupt-parent", reference: "&gpio_expander" },
            { path: "/soc/spi@7e204000/adc@0", property: "clocks", reference: "&ref" },
        ]);
    });

    test("unresolved_references — path references and top-level references", () => {
        const overlay = setup(`&{/} {
    aliases {
        adc0 = &adc;
        spi = &{/soc/spi@7e204000};
        gone = &{/soc/nope};
    };
};`);
        expect(unresolved_references(overlay)).toEqual([
            { path: "/aliases", property: "adc0", reference: "&adc" },
            { path: "/aliases", property: "gone", reference: "&{/soc/nope}" },
        ]);
    });

    test("unresolved_references — only under a path", () => {
        const overlay = setup(`&spi0 {
    adc@0 { interrupt-parent = <&missing_a>; };
    dac@1 { interrupt-parent = <&missing_b>; };
};`);
        expect(unresolved_references(overlay, "/soc/spi@7e204000/dac@1").map(r => r.reference)).toEqual(["&missing_b"]);
    });

    test("unresolved_targets — a target label or path the base doesn't have", () => {
        const overlay = setup(`&spi0 {
    status = "okay";
};

&spi7 {
    status = "okay";
};

&{/soc/nope} {
    status = "okay";
};`);
        expect(unresolved_targets(overlay)).toEqual([
            { fragment: 1, target: "&spi7" },
            { fragment: 2, target: "/soc/nope" },
        ]);
    });

    test("unresolved_targets — overlay labels and label-relative target paths", () => {
        const overlay = setup(`/ {
    fragment@0 {
        target = <&spi0>;
        __overlay__ { adc: adc@0 { reg = <0>; }; };
    };
    fragment@1 {
        target = <&adc>;
        __overlay__ { status = "okay"; };
    };
    fragment@2 {
        target-path = "spi0/adc@0";
        __overlay__ { status = "okay"; };
    };
    fragment@3 {
        target-path = "spi0/dac@1";
        __overlay__ { status = "okay"; };
    };
};`);
        expect(unresolved_targets(overlay)).toEqual([{ fragment: 3, target: "spi0/dac@1" }]);
    });

    test("labels on __overlay__ and inside __dormant__ fragments resolve", () => {
        const overlay = setup(`/ {
    fragment@0 {
        target = <&spi0>;
        frag0: __overlay__ { status = "okay"; };
    };
    fragment@1 {
        target = <&spi0>;
        __dormant__ { expander: gpio@0 { reg = <0>; interrupt-parent = <&gone>; }; };
    };
    fragment@2 {
        target = <&expander>;
        __overlay__ { status = "okay"; link = <&frag0>; };
    };
};`);
        expect(unresolved_targets(overlay)).toEqual([]);
        expect(unresolved_references(overlay)).toEqual([
            { path: "/soc/spi@7e204000/gpio@0", property: "interrupt-parent", reference: "&gone" },
        ]);
    });
}
