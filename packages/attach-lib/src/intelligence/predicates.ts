import { DeviceTree } from "../Devicetree.js";
import { DTNode, is_dt_flag } from "../DTBuilder/parser";

export function is_interrupt_controller(node: DTNode): boolean {
    return node.properties.some(
        p => p.name === "interrupt-controller" && is_dt_flag(p.value)
    );
}

export function is_clock(node: DTNode): boolean {
    return node.properties.some(
        p => p.name === "compatible" &&
            !is_dt_flag(p.value) &&
            p.value.some(v => v.kind === "string" && v.value === "fixed-clock")
    );
}

export function is_regulator(node: DTNode): boolean {
    return node.properties.some(
        p => p.name === "compatible" &&
            !is_dt_flag(p.value) &&
            p.value.some(v => v.kind === "string" && v.value === "regulator-fixed")
    );
}

export function is_gpio_controller(node: DTNode): boolean {
    return node.properties.some(p => p.name === "compatible") &&
        node.properties.some(p => p.name === "gpio-controller" && is_dt_flag(p.value)) &&
        node.properties.some(p => p.name === "#gpio-cells");
}

export function is_dma_controller(node: DTNode): boolean {
    return node.properties.some(p => p.name === "compatible") &&
        node.properties.some(p => p.name === "#dma-cells");
}

export function is_pwm_controller(node: DTNode): boolean {
    return node.properties.some(p => p.name === "compatible") &&
        node.properties.some(p => p.name === "#pwm-cells");
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
            .filter((element) => is_interrupt_controller(element))
            .toArray()
            .map(([n]) => n.name);
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
        const results = dt.as_stream().filter((element) => is_interrupt_controller(element)).toArray();
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
        const results = dt.as_stream().filter((element) => is_clock(element)).toArray();
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
        const results = dt.as_stream().filter((element) => is_gpio_controller(element)).toArray();
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
        const results = dt.as_stream().filter((element) => is_gpio_controller(element)).toArray();
        expect(results).toHaveLength(0);
    });
}
