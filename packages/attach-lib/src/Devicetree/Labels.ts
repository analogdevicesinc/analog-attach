const LABEL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function is_valid_label(label: string): boolean {
    return LABEL_RE.test(label);
}

export function label_from_compatible(compatible: string): string {
    const comma = compatible.indexOf(",");
    const base = comma === -1 ? compatible : compatible.slice(comma + 1);
    const vendor = comma === -1 ? undefined : compatible.slice(0, comma);
    let sanitized = base.replaceAll(/[^A-Za-z0-9_]/g, "_");
    if (/^\d/.test(sanitized)) {
        sanitized = vendor !== undefined ? `${vendor.replaceAll(/[^A-Za-z0-9_]/g, "_")}_${sanitized}` : `_${sanitized}`;
    }
    return sanitized;
}

export function unique_label(base_label: string, all_labels: Map<string, string>): string {
    if (!all_labels.has(base_label)) { return base_label; }
    for (let index = 1; ; index++) {
        const candidate = `${base_label}_${index}`;
        if (!all_labels.has(candidate)) { return candidate; }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("is_valid_label", () => {
        expect(is_valid_label("spi0")).toBe(true);
        expect(is_valid_label("_ok")).toBe(true);
        expect(is_valid_label("ad7124_8")).toBe(true);
        expect(is_valid_label("1bad")).toBe(false);
        expect(is_valid_label("")).toBe(false);
        expect(is_valid_label("has-dash")).toBe(false);
        expect(is_valid_label("has.dot")).toBe(false);
    });

    test("label_from_compatible derivation table", () => {
        expect(label_from_compatible("adi,ad7124-8")).toBe("ad7124_8");
        expect(label_from_compatible("spidev")).toBe("spidev");
        expect(label_from_compatible("ti,74hc595")).toBe("ti_74hc595");
        expect(label_from_compatible("vnd,a.b+c")).toBe("a_b_c");
        expect(label_from_compatible("9x")).toBe("_9x");
    });

    test("unique_label", () => {
        const labels = new Map<string, string>([["ad7124_8", "/spi0/adc@0"]]);
        expect(unique_label("ad7124_8", labels)).toBe("ad7124_8_1");
        labels.set("ad7124_8_1", "/spi0/adc@1");
        expect(unique_label("ad7124_8", labels)).toBe("ad7124_8_2");
        expect(unique_label("spidev", labels)).toBe("spidev");
    });
}
