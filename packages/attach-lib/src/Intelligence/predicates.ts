import { DeviceTree, DTNode, has_flag, has_property, has_compatible } from "../Devicetree/index.js";

export function is_interrupt_controller(node: DTNode): boolean {
    return has_flag(node, "interrupt-controller");
}

export function is_clock(node: DTNode): boolean {
    return has_compatible(node, "fixed-clock");
}

export function is_regulator(node: DTNode): boolean {
    return has_compatible(node, "regulator-fixed");
}

export function is_gpio_controller(node: DTNode): boolean {
    return has_property(node, "compatible") &&
        has_flag(node, "gpio-controller") &&
        has_property(node, "#gpio-cells");
}

export function is_dma_controller(node: DTNode): boolean {
    return has_property(node, "compatible") &&
        has_property(node, "#dma-cells");
}

export function is_pwm_controller(node: DTNode): boolean {
    return has_property(node, "compatible") &&
        has_property(node, "#pwm-cells");
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const dts = (source: string) => {
        const dt = DeviceTree.new_from_string(source);
        if (typeof dt === "string") { throw new TypeError(dt); }
        return dt;
    };

    test("is_interrupt_controller — matches interrupt-controller flag", () => {
        const dt = dts(`/dts-v1/;
/ {
    gic: interrupt-controller@ff841000 {
        interrupt-controller;
        #interrupt-cells = <3>;
    };
};`);
        const results = dt.as_stream()
            .filter(({ node }) => is_interrupt_controller(node))
            .toArray()
            .map(({ node }) => node.name);
        expect(results).toContain("interrupt-controller");
    });

    test("is_interrupt_controller — does not match normal node", () => {
        const dt = dts(`/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
        };
    };
};`);
        const results = dt.as_stream().filter(({ node }) => is_interrupt_controller(node)).toArray();
        expect(results).toHaveLength(0);
    });

    test("is_clock — matches fixed-clock compatible", () => {
        const dt = dts(`/dts-v1/;
/ {
    clk: fixed-clock {
        compatible = "fixed-clock";
        #clock-cells = <0>;
        clock-frequency = <19200000>;
    };
};`);
        const results = dt.as_stream().filter(({ node }) => is_clock(node)).toArray();
        expect(results).toHaveLength(1);
    });

    test("is_gpio_controller — matches gpio-controller with cells", () => {
        const dt = dts(`/dts-v1/;
/ {
    gpio0: gpio@fe200000 {
        compatible = "brcm,bcm2835-gpio";
        gpio-controller;
        #gpio-cells = <2>;
    };
};`);
        const results = dt.as_stream().filter(({ node }) => is_gpio_controller(node)).toArray();
        expect(results).toHaveLength(1);
    });

    test("is_gpio_controller — does not match node missing gpio-controller flag", () => {
        const dt = dts(`/dts-v1/;
/ {
    gpio0: gpio@fe200000 {
        compatible = "brcm,bcm2835-gpio";
        #gpio-cells = <2>;
    };
};`);
        const results = dt.as_stream().filter(({ node }) => is_gpio_controller(node)).toArray();
        expect(results).toHaveLength(0);
    });
}
