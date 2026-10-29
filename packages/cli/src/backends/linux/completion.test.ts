// The Linux backend's completion through the front end's `__complete`, in the workspace of
// testing/fixture.ts: every slot the routes give reaches `complete` and is answered, and
// the cases of attach-linux's completion drift test still give the same candidates, now
// from the real data functions instead of a mocked `__list`.

import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { Registry } from "../../front/registry";
import { build_routes, type FrontEnd } from "../../front/routes";
import { FILES_DIRECTIVE, GROUP_DIRECTIVE, NOSPACE_DIRECTIVE } from "../../front/stubs";
import type { Backend, Completion, Slot } from "../../interface/backend-interface";
import { complete_slot } from "./complete";
import { backend } from "./index";
import { create_linux_fixture, type LinuxFixture } from "./testing/fixture";

/** A binding with a property pattern that lists its names and a child-node pattern too wide to list (a stem). */
const FAN_YAML = `%YAML 1.2
---
$id: http://devicetree.org/schemas/hwmon/adi,fan000.yaml#
$schema: http://devicetree.org/meta-schemas/core.yaml#

title: Analog Devices FAN000 fan controller

properties:
  compatible:
    const: adi,fan000
  reg:
    maxItems: 1

required:
  - compatible
  - reg

patternProperties:
  "^adi,bypass-attenuator-in[0-4]$":
    type: boolean
  "^fan-[0-9]+$":
    type: object

additionalProperties: false
`;

const OVERLAY = `/dts-v1/;
/plugin/;

&spi0 {
\tstatus = "okay";
\tadc: adc@0 {
\t\tcompatible = "adi,ad7124-8";
\t\treg = <0>;
\t};
\thwmon@1 {
\t\tcompatible = "adi,fan000";
\t\treg = <1>;
\t\tadi,bypass-attenuator-in1;
\t};
};
`;

/** An RPi overlay of the Linux tree that adds an ad7124-8. */
const OVERLAY_FILE = `/dts-v1/;
/plugin/;
/ {
\tcompatible = "brcm,bcm2835";
\tfragment@0 {
\t\ttarget = <&spi0>;
\t\t__overlay__ {
\t\t\tadc@0 {
\t\t\t\tcompatible = "adi,ad7124-8";
\t\t\t\treg = <0>;
\t\t\t};
\t\t};
\t};
};
`;

let fixture: LinuxFixture;
/** The slots `complete` got, and what it threw. */
let slots: Slot[];
let errors: unknown[];

/** The Linux backend, with a `complete` that records its slots and lets an error through to `errors`. */
const recording: Backend = {
    ...backend,
    async complete(slot, partial, session): Promise<Completion> {
        slots.push(slot);
        try {
            return await complete_slot(slot, partial, session);
        } catch (error) {
            errors.push(error);
            throw error;
        }
    },
};
const registry: Registry = { linux: () => Promise.resolve(recording) };

async function complete(words: readonly string[]): Promise<string[]> {
    const { code, stdout, stderr } = await fixture.run(["__complete", "--", ...words], { registry });
    expect(code).toBe(0);
    expect(stderr).toBe("");
    return stdout === "" ? [] : stdout.trimEnd().split("\n");
}

const values = (lines: readonly string[]): string[] => lines.filter(line => !line.startsWith("__ANALOG_ATTACH")).map(line => line.split("\t")[0]!);

beforeEach(() => {
    fixture = create_linux_fixture();
    fixture.write_binding(path.join("hwmon", "adi,fan000.yaml"), FAN_YAML, ["adi,fan000"]);
    fixture.configure();
    fs.writeFileSync(path.join(fixture.project, "overlay.dtso"), OVERLAY);
    const overlays = path.join(fixture.linux, "arch", "arm", "boot", "dts", "overlays");
    fs.mkdirSync(overlays, { recursive: true });
    fs.writeFileSync(path.join(overlays, "ad7124-overlay.dts"), OVERLAY_FILE);
    slots = [];
    errors = [];
});

afterEach(() => {
    fixture.remove();
});

describe("every slot of the Linux routes reaches complete and is answered", () => {
    /** A word for each positional typed before the one completed. */
    const SAMPLE: Readonly<Record<string, string>> = {
        path: "spi0/adc@0", property: "compatible", values: "1", device: "adi,ad7124-8", filter: "adi", compatible: "adi,ad7124-8",
        source: "ad7124-overlay.dts", destination: "spi0", name: "adc2", member: "x",
    };
    const routes = build_routes({
        program: "analog-attach", backend, registry, home: "/home/nobody", environment: {},
    } as unknown as FrontEnd).filter(route => route.supported && route.complete === undefined && !["config", "completion", "skill"].includes(route.path[0]!));

    test("the routes are the shared commands Linux implements and its extras", () => {
        const names = routes.map(route => route.path.join(" "));
        expect(names).toEqual(expect.arrayContaining(["add", "read", "update", "delete", "rename", "import", "list devices", "list property", "list value", "move", "enable", "disable", "list parent", "list overlay"]));
        expect(names).not.toContain("list context");
    });

    test("each positional with a slot, and each flag that takes a value", async () => {
        const kinds = new Set<string>();
        for (const route of routes) {
            for (const [index, positional] of route.positionals.entries()) {
                if (positional.slot === undefined) { continue; }
                const prior = route.positionals.slice(0, index).map(spec => SAMPLE[spec.name] ?? "x");
                slots = [];
                await complete([...route.path, ...prior, ""]);
                expect(slots, `${route.path.join(" ")} <${positional.name}>`).toEqual([positional.slot(prior)]);
                kinds.add(slots[0]!.kind);
            }
            for (const [flag, spec] of Object.entries(route.flags)) {
                if (spec.kind === "boolean") { continue; }
                const prior = route.path[0] === "add" ? ["adi,ad7124-8"] : [];
                slots = [];
                await complete([...route.path, ...prior, `--${flag}`, ""]);
                expect(slots, `${route.path.join(" ")} --${flag}`).toEqual([{ kind: "flag", command: route.path.join(" "), flag, prior }]);
                kinds.add("flag");
            }
        }
        expect(errors).toEqual([]);
        expect([...kinds].sort()).toEqual(["device", "extra", "flag", "path", "property", "source", "value"]);
    });
});

describe("Linux completion", () => {
    test("add's device and list devices' filter: the compatibles of the index that start with the word", async () => {
        expect(values(await complete(["add", ""]))).toEqual(["adi,ad7124-4", "adi,ad7124-8", "adi,adxl000", "adi,fan000"]);
        expect(values(await complete(["add", "adi,ad7"]))).toEqual(["adi,ad7124-4", "adi,ad7124-8"]);
        expect(values(await complete(["list", "devices", "adi,f"]))).toEqual(["adi,fan000"]);
        expect(await complete(["add", "ad7"])).toEqual([]);
    });

    test("import: the overlay files of the tree, described by their path, then any file", async () => {
        expect(await complete(["import", "ad"])).toEqual([FILES_DIRECTIVE, "ad7124-overlay.dts\tarch/arm/boot/dts/overlays/ad7124-overlay.dts"]);
        expect(await complete(["import", "x"])).toEqual([FILES_DIRECTIVE]);
    });

    test("a node path: the entry points with a trailing / and no space, then the children joined to the parent", async () => {
        expect(await complete(["read", ""])).toEqual([NOSPACE_DIRECTIVE, "spi0/"]);
        expect(await complete(["read", "spi"])).toEqual([NOSPACE_DIRECTIVE, "spi0/"]);
        expect(await complete(["read", "spi0/"])).toEqual(["spi0/adc@0", "spi0/hwmon@1"]);
        expect(await complete(["read", "spi0/h"])).toEqual(["spi0/hwmon@1"]);
        // A leading / is the root.
        expect(await complete(["update", "/so"])).toEqual(["/soc"]);
        expect(await complete(["read", "nope/"])).toEqual([]);
        // move's node and destination, enable's and disable's node.
        expect(await complete(["move", "adc", ""])).toEqual([NOSPACE_DIRECTIVE, "spi0/"]);
        expect(await complete(["enable", "spi0/"])).toEqual(["spi0/adc@0", "spi0/hwmon@1"]);
    });

    test("the property positional: set then not set, each under a group line, required ones described", async () => {
        const lines = await complete(["update", "spi0/adc@0", ""]);
        expect(lines.slice(0, 3)).toEqual([`${GROUP_DIRECTIVE}\tset`, "compatible\trequired", "reg\trequired"]);
        expect(lines).toContain(`${GROUP_DIRECTIVE}\tnot set`);
        expect(lines.slice(lines.indexOf(`${GROUP_DIRECTIVE}\tnot set`) + 1)).toEqual(expect.arrayContaining(["spi-max-frequency", "interrupts", "channel@0\tchild node", "channel@15\tchild node"]));
        expect(await complete(["read", "spi0/adc@0", "r"])).toEqual([`${GROUP_DIRECTIVE}\tset`, "reg\trequired"]);
        expect(await complete(["list", "property", "spi0/adc@0", "spi"])).toEqual([`${GROUP_DIRECTIVE}\tnot set`, "spi-max-frequency"]);
    });

    test("binding patterns: the names a pattern lists, and a stem that completes without a trailing space", async () => {
        expect(await complete(["update", "spi0/hwmon@1", "fa"])).toEqual([NOSPACE_DIRECTIVE, `${GROUP_DIRECTIVE}\tnot set`, "fan-\tchild node ^fan-[0-9]+$"]);
        expect(await complete(["update", "spi0/hwmon@1", "adi,"])).toEqual([
            `${GROUP_DIRECTIVE}\tset`, "adi,bypass-attenuator-in1",
            `${GROUP_DIRECTIVE}\tnot set`, "adi,bypass-attenuator-in0\tpattern", "adi,bypass-attenuator-in2\tpattern", "adi,bypass-attenuator-in3\tpattern", "adi,bypass-attenuator-in4\tpattern",
        ]);
    });

    test("delete's property: only what the overlay sets", async () => {
        expect(await complete(["delete", "spi0/adc@0", ""])).toEqual([`${GROUP_DIRECTIVE}\tset`, "compatible", "reg"]);
        expect(await complete(["delete", "spi0", ""])).toEqual([`${GROUP_DIRECTIVE}\tset`, "status"]);
    });

    test("update's values: what list value suggests; a quoted word is dequoted first", async () => {
        expect(values(await complete(["update", "spi0/adc@0", "compatible", ""]))).toEqual(["adi,ad7124-4", "adi,ad7124-8"]);
        expect(values(await complete(["update", "spi0/adc@0", "compatible", "\"adi,ad7124-4"]))).toEqual(["adi,ad7124-4"]);
        // list value's member: Linux has none.
        expect(await complete(["list", "value", "spi0/adc@0", "compatible", ""])).toEqual([]);
    });

    test("add --parent: the valid parents of the device, then the children after a /", async () => {
        expect(await complete(["add", "adi,ad7124-8", "--parent", ""])).toEqual([NOSPACE_DIRECTIVE, "spi0/\t/soc/spi@7e204000"]);
        expect(await complete(["add", "adi,ad7124-8", "--parent", "i2c"])).toEqual([]);
        expect(await complete(["add", "adi,ad7124-8", "--parent", "spi0/"])).toEqual(["spi0/adc@0", "spi0/hwmon@1"]);
        expect(await complete(["add", "adi,ad7124-8", "--parent", "/s"])).toEqual(["/soc"]);
        // Without the device, nothing.
        expect(await complete(["add", "--parent", ""])).toEqual([]);
    });

    test("add --template: required, then the overlays with the device, with their fit", async () => {
        const lines = await complete(["add", "adi,ad7124-8", "--template", ""]);
        expect(lines[0]).toBe("required\tinterview for the required properties");
        expect(lines[1]).toBe("overlay:ad7124-overlay.dts\tincompatible (overlay: brcm,bcm2835; base: )");
        expect(values(await complete(["add", "adi,ad7124-8", "--template", "o"]))).toEqual(["overlay:ad7124-overlay.dts"]);
        expect(await complete(["add", "adi,ad7124-8", "--label", ""])).toEqual([]);
    });

    test("the extras: list's new kinds, and list parent's and list overlay's device", async () => {
        expect(values(await complete(["list", ""]))).toEqual(["devices", "property", "value", "parent", "overlay"]);
        expect(values(await complete(["list", "parent", "adi,ad7"]))).toEqual(["adi,ad7124-4", "adi,ad7124-8"]);
        expect(values(await complete(["list", "overlay", "adi,a"]))).toEqual(["adi,ad7124-4", "adi,ad7124-8", "adi,adxl000"]);
        expect(values(await complete([""]))).toEqual(expect.arrayContaining(["move", "enable", "disable"]));
    });

    test("nothing, silently, without caches or settings", async () => {
        fs.rmSync(fixture.state_directory(), { recursive: true });
        expect(await complete(["add", ""])).toEqual([]);
        expect(await complete(["import", ""])).toEqual([FILES_DIRECTIVE]);
        // The base and the overlay need no cache.
        expect(await complete(["read", ""])).toEqual([NOSPACE_DIRECTIVE, "spi0/"]);
        fs.rmSync(path.join(fixture.project, ".analog-attach"), { recursive: true });
        fixture.write_settings({});
        expect(await complete(["read", ""])).toEqual([]);
        expect(errors).toEqual([]);
    });
});
