// The Linux backend through the front end's `main`, in the tiny workspace of
// testing/fixture.ts.

import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { Registry } from "../../front/registry";
import { create_setup } from "./commands/setup/command";
import { BASE_DTS, create_linux_fixture, IMPORTED, OVERLAY, scripted, type LinuxFixture, type RunOptions, type RunResult } from "./testing/fixture";

/** The fixture's base with a second, empty SPI bus. */
const BASE_WITH_SPI1 = BASE_DTS.replace("\t};\n};\n", "\t\tspi1: spi@7e215080 {\n\t\t\tcompatible = \"brcm,bcm2835-aux-spi\";\n\t\t\t#address-cells = <1>;\n\t\t\t#size-cells = <0>;\n\t\t};\n\t};\n};\n");

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
let base: string;
let project: string;
let linux: string;

const write_settings = (values: Record<string, string>): void => { fixture.write_settings(values); };
const write_caches = (): void => { fixture.write_caches(); };
const configure = (): void => { fixture.configure(); };
const run = (argv: readonly string[], options: RunOptions = {}): Promise<RunResult> => fixture.run(argv, options);

beforeEach(() => {
    fixture = create_linux_fixture();
    ({ base, project, linux } = fixture);
});

afterEach(() => {
    fixture.remove();
});

describe("the Linux backend through main", () => {
    test("--json read: the node as the base and the overlay have it, each value with its source", async () => {
        write_settings({ linux, devicetree: path.join(base, "base.dts"), workfile: path.join(project, "overlay.dtso") });
        const result = await run(["--json", "read", "spi0"]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
            kind: "node",
            key: "spi@7e204000",
            origin: "both",
            alias: ["spi0"],
            properties: [
                { key: "compatible", source: "base" },
                { key: "#address-cells", source: "base" },
                { key: "#size-cells", source: "base" },
                { key: "status", source: "overlay", value: "okay" },
            ],
            children: [{ key: "adc@0", origin: "overlay" }],
        });

        const text = await run(["read", "spi0", "status"]);
        expect(text).toEqual({ code: 0, stdout: `status = "okay";\n`, stderr: "" });

        const whole = await run(["--json", "read"]);
        expect(JSON.parse(whole.stdout)).toMatchObject({ key: "/", origin: "overlay", children: [{ key: "adc@0", origin: "overlay" }] });
    });

    test("--json read of a property: what its binding says of it, which --quiet leaves out", async () => {
        configure();
        const read_json = async (argv: readonly string[]): Promise<Record<string, unknown>> => {
            const result = await run(["--json", "read", ...argv]);
            return JSON.parse(result.stdout) as Record<string, unknown>;
        };
        const reg = await read_json(["adc", "reg"]);
        expect(reg).toMatchObject({ key: "reg", source: "overlay", required: true, definition: "adi,ad7124.yaml" });
        expect(reg).not.toHaveProperty("constraints");

        await run(["update", "adc", "spi-max-frequency", "1000000"]);
        expect(await read_json(["adc", "spi-max-frequency"])).toMatchObject({ required: false, constraints: { maximum: 5_000_000 }, definition: "adi,ad7124.yaml" });

        const quiet = await read_json(["--quiet", "adc", "reg"]);
        for (const key of ["required", "constraints", "definition", "description"]) { expect(quiet).not.toHaveProperty(key); }
    });

    test("a refused rename: exit 0, the reason on stdout, ok: false under --json; the workfile is unchanged", async () => {
        write_settings({ linux, devicetree: path.join(base, "base.dts"), workfile: path.join(project, "overlay.dtso") });
        const text = await run(["rename", "spi0", "spi1"]);
        expect(text.code).toBe(0);
        expect(text.stdout).toContain("spi0 is part of the base device tree");
        const json = await run(["--json", "rename", "/", "top"]);
        expect(json.code).toBe(0);
        expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, severity: "error" });
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toBe(OVERLAY);

        const renamed = await run(["--json", "rename", "adc", "adc@1"]);
        expect(JSON.parse(renamed.stdout)).toMatchObject({ ok: true, message: "Renamed adc to adc@1; reg first cell set to 1" });
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("adc: adc@1 {");
    });

    test("init creates the configured workfile, then keeps it", async () => {
        const workfile = path.join(project, "new.dtso");
        write_settings({ linux, devicetree: path.join(base, "base.dts"), workfile });
        write_caches();
        const first = await run(["--json", "init"]);
        expect(first.code).toBe(0);
        expect(first.stderr).toBe("");
        expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, path: workfile, overlay: workfile, created: true, linux, devicetree: path.join(base, "base.dts") });
        expect(fs.readFileSync(workfile, "utf8")).toContain("/plugin/;");

        const second = await run(["init"]);
        expect(second.code).toBe(0);
        expect(second.stdout).toContain(`Overlay:     ${workfile} (kept)`);
        expect(second.stdout).toContain("analog-attach list devices [filter]");
    });

    test("a workspace that isn't configured: the setup hint, a refusal in text, exit 2 under --json", async () => {
        write_settings({});
        const text = await run(["read", "spi0"]);
        expect(text.code).toBe(0);
        expect(text.stdout).toContain("Missing config field devicetree");
        expect(text.stdout).toContain("Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', 'config devicetree <path>' and 'config workfile <name>', then 'analog-attach init', to set up a workspace.");
        const json = await run(["--json", "read", "spi0"]);
        expect(json).toMatchObject({ code: 2, stdout: "" });
        expect(JSON.parse(json.stderr)).toMatchObject({ errors: [{ field: "devicetree" }, { field: "linux" }, { field: "workfile" }] });
    });
    test("--json list devices: the compatibles that contain the filter; the one it names described", async () => {
        configure();
        const named = await run(["--json", "list", "devices", "adi,ad7124-8"]);
        expect(named.code).toBe(0);
        expect(JSON.parse(named.stdout)).toMatchObject({
            ok: true,
            message: "Device adi,ad7124-8",
            devices: [{ key: "adi,ad7124-8" }],
            names: ["adi,ad7124-8"],
            device: {
                key: "adi,ad7124-8",
                compatible: "adi,ad7124-8",
                title: "Analog Devices AD7124 ADC",
                binding: path.join(linux, "Documentation", "devicetree", "bindings", "iio", "adc", "adi,ad7124.yaml"),
                children: [{ name: "channel@N" }],
            },
        });

        const both = await run(["--json", "list", "devices", "ad7124"]);
        const response = JSON.parse(both.stdout) as Record<string, unknown>;
        expect(response).toMatchObject({ message: "Found 2 devices", devices: [{ key: "adi,ad7124-4" }, { key: "adi,ad7124-8" }] });
        expect(response).not.toHaveProperty("device");
        expect(await run(["list", "devices", "ad7124"])).toEqual({ code: 0, stdout: "adi,ad7124-4\nadi,ad7124-8\n", stderr: "" });
    });

    test("--json list property: a node's properties marked set and required; one property's type", async () => {
        configure();
        const names = await run(["--json", "list", "property", "adc"]);
        expect(names.code).toBe(0);
        const response = JSON.parse(names.stdout) as { names: string[]; suggestions: { value: string; display_string?: string }[] };
        expect(response.names).toEqual(expect.arrayContaining(["compatible", "reg", "spi-max-frequency", "^channel@([0-9]|1[0-5])$"]));
        expect(response.suggestions).toContainEqual({ value: "reg", display_string: "reg (set, required)" });

        const reg = await run(["--json", "list", "property", "adc", "reg"]);
        expect(JSON.parse(reg.stdout)).toMatchObject({ ok: true, message: "Type of reg", property: { name: "reg", required: true, set: true } });

        const missing = await run(["--json", "list", "property"]);
        expect(missing.code).toBe(2);
    });

    test("--json update: a value written; a warning on stderr makes the response a warn", async () => {
        configure();
        const set = await run(["--json", "update", "adc", "spi-max-frequency", "1000000"]);
        expect(set.code).toBe(0);
        expect(JSON.parse(set.stdout)).toEqual({ ok: true, message: "Set spi-max-frequency on adc", severity: "info" });
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("spi-max-frequency = <1000000>;");

        const warned = await run(["--json", "update", "adc", "interrupts", "25", "8"]);
        expect(warned.code).toBe(0);
        expect(JSON.parse(warned.stdout)).toMatchObject({ ok: true, message: "Set interrupts on adc", severity: "warn" });
        expect(warned.stderr).toContain("No interrupt-parent inherited for /soc/spi@7e204000/adc@0");

        const read = await run(["update", "adc", "spi-max-frequency", "--quiet"]);
        expect(read).toEqual({ code: 0, stdout: "spi-max-frequency = <1000000>;\n", stderr: "" });
    });

    test("update <path> <child>: the child created, its missing required properties listed", async () => {
        configure();
        const json = await run(["--json", "update", "adc", "channel@0"]);
        expect(json.code).toBe(0);
        expect(JSON.parse(json.stdout)).toMatchObject({
            ok: true,
            message: "Added channel@0 to adc",
            path: ["soc", "spi@7e204000", "adc@0", "channel@0"],
            missing_required: [{ property: "diff-channels" }],
        });
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("channel@0 {");

        const text = await run(["update", "adc", "channel@1"]);
        expect(text.stdout).toContain("Added channel@1 to adc");
        expect(text.stdout).toContain("Set them with: update adc/channel@1 <property> <value>");

        const refused = await run(["--json", "update", "adc", "channel@0", "1"]);
        expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, message: "channel@0 is a child node; set its properties with `update adc/channel@0 <prop> <value>`" });
    });

    test("import: a new workfile from an overlay file, now the configured one; the unresolved reference a warning", async () => {
        configure();
        fs.writeFileSync(path.join(project, "extra-overlay.dts"), IMPORTED);
        const result = await run(["--json", "import", "extra-overlay.dts"]);
        expect(result.code).toBe(0);
        const workfile = path.join(project, "extra.dtso");
        expect(JSON.parse(result.stdout)).toMatchObject({
            ok: true,
            severity: "warn",
            path: workfile,
            source: path.join(project, "extra-overlay.dts"),
            replaced: path.join(project, "overlay.dtso"),
            unresolved: [{ path: ["soc", "spi@7e204000", "dac@1"], property: "vref-supply", reference: "&vref" }],
        });
        expect(result.stderr).toContain("vref-supply → &vref");
        expect(JSON.parse(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8"))).toMatchObject({ backend: "linux", linux: { workfile } });

        const read = await run(["read", "--quiet", "spi0/dac@1", "reg"]);
        expect(read).toEqual({ code: 0, stdout: "reg = <1>;\n", stderr: "" });
    });

    test("--json add: the node under the first SPI bus, with its unit address and label; missing_required built for the response", async () => {
        configure();
        const result = await run(["--json", "add", "adi,adxl000"]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
            ok: true,
            message: "Added adi,adxl000@1 (label: adxl000)",
            key: "adi,adxl000@1",
            path: ["soc", "spi@7e204000", "adi,adxl000@1"],
            template: "required",
            missing_required: [{ property: "adi,mode", suggestions: [{ value: "fast" }, { value: "slow" }] }, { property: "spi-max-frequency" }],
        });
        expect(result.stderr).toBe("Parent: spi0 (use --parent to choose another)\nPicked chip select 1 (taken: 0 by adc@0).\nTo change it: rename adxl000 adi,adxl000@<n>\n");
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("adxl000: adi,adxl000@1 {\n\t\t\t\tcompatible = \"adi,adxl000\";\n\t\t\t\treg = <1>;\n\t\t\t};");

        const duplicate = await run(["--json", "add", "adi,ad7124-4", "--parent", "spi0", "--name", "adc@0"]);
        expect(JSON.parse(duplicate.stdout)).toMatchObject({ ok: false });
    });

    test("add off a terminal: nothing asked, the missing required properties listed", async () => {
        configure();
        const result = await run(["add", "adi,adxl000"]);
        expect(result).toEqual({
            code: 0,
            stdout: [
                `Added adi,adxl000@1 (label: adxl000) to ${path.join(project, "overlay.dtso")}`,
                "Missing required: adi,mode, spi-max-frequency",
                "Set them with: update adxl000 <property> <value>",
                "",
            ].join("\n"),
            stderr: "Parent: spi0 (use --parent to choose another)\nPicked chip select 1 (taken: 0 by adc@0).\nTo change it: rename adxl000 adi,adxl000@<n>\n",
        });
    });

    test("add on a terminal: the parent question, then the interview, through the prompter", async () => {
        configure();
        const prompter = scripted(["", "b", "1000000"]);
        const result = await run(["add", "adi,adxl000"], { prompter });
        expect(result.code).toBe(0);
        expect(prompter.asked).toEqual(["parent [a]", "adi,mode [a]", "spi-max-frequency"]);
        expect(result.stdout).toContain("Where does adi,adxl000 go? (Enter takes a, a letter picks, or type a label or path, Ctrl-D stops)\n  a) spi0  /soc/spi@7e204000\n");
        expect(result.stdout).toContain(`Added adi,adxl000@1 (label: adxl000) to ${path.join(project, "overlay.dtso")}\n\n2 required properties to set`);
        expect(result.stdout).toMatch(/Set spi-max-frequency on adxl000\n\nAll required properties are set\.\n$/);
        expect(result.stderr).not.toContain("Parent:");
        const written = fs.readFileSync(path.join(project, "overlay.dtso"), "utf8");
        expect(written).toContain("adi,mode = \"slow\";");
        expect(written).toContain("spi-max-frequency = <1000000>;");
    });

    test("add on a terminal: Ctrl-C in the interview keeps the node and lists what is missing, exit 0", async () => {
        configure();
        const prompter = scripted(["", "a"]);
        const result = await run(["add", "adi,adxl000"], { prompter });
        expect(result.code).toBe(0);
        expect(result.stdout).toMatch(/Missing required: spi-max-frequency\nSet them with: update adxl000 <property> <value>\n$/);
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("adi,mode = \"fast\";");
    });

    test("update <path> <child> on a terminal: the child's missing required properties asked", async () => {
        configure();
        const prompter = scripted(["0 1"]);
        const result = await run(["update", "adc", "channel@0"], { prompter });
        expect(result.code).toBe(0);
        expect(prompter.asked).toEqual(["diff-channels"]);
        expect(result.stdout).toMatch(/^Added channel@0 to adc\n\n1 required property to set/);
        expect(result.stdout).toMatch(/All required properties are set\.\n$/);
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toContain("diff-channels = <0 1>;");
    });

    test("add on a terminal: Ctrl-C at the parent question adds nothing, exit 130", async () => {
        configure();
        const prompter = scripted([]);
        const result = await run(["add", "adi,adxl000"], { prompter });
        expect(result.code).toBe(130);
        expect(result.stdout).toMatch(/No parent chosen; nothing added\.\n$/);
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toBe(OVERLAY);
    });

    test("--json move: the node under its new parent; a refusal keeps the workfile", async () => {
        configure();
        fs.writeFileSync(path.join(base, "base.dts"), BASE_WITH_SPI1);
        const into_self = await run(["--json", "move", "adc", "adc"]);
        expect(into_self.code).toBe(0);
        expect(JSON.parse(into_self.stdout)).toEqual({ ok: false, message: "Cannot move adc into itself or one of its descendants", severity: "error" });
        const nowhere = await run(["--json", "move", "adc", "i2c9"]);
        expect(JSON.parse(nowhere.stdout)).toEqual({ ok: false, message: "Parent node i2c9 not found", severity: "error" });
        expect(await run(["move", "adc", "i2c9"])).toMatchObject({ stdout: `Couldn't find parent node i2c9 in ${path.join(base, "base.dts")} or ${path.join(project, "overlay.dtso")}\n` });
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toBe(OVERLAY);

        const moved = await run(["--json", "move", "adc", "spi1"]);
        expect(moved).toEqual({ code: 0, stdout: `${JSON.stringify({ ok: true, message: "Moved adc to spi1", severity: "info" })}\n`, stderr: "" });
        const written = fs.readFileSync(path.join(project, "overlay.dtso"), "utf8");
        expect(written).toMatch(/target = <&spi1>;\n\t\t__overlay__ \{\n\t\t\tadc: adc@0 \{/);
        expect(await run(["move", "adc", "spi0"])).toMatchObject({ stdout: `Moved adc to spi0 in ${path.join(project, "overlay.dtso")}\n` });
    });

    test("--json enable / disable: the status written, a base node gets a fragment; an unknown node refused", async () => {
        configure();
        fs.writeFileSync(path.join(base, "base.dts"), BASE_WITH_SPI1);
        const enabled = await run(["--json", "enable", "spi1"]);
        expect(JSON.parse(enabled.stdout)).toEqual({ ok: true, message: "Enabled spi1", severity: "info" });
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toMatch(/target = <&spi1>;\n\t\t__overlay__ \{\n\t\t\tstatus = "okay";/);
        const disabled = await run(["disable", "adc"]);
        expect(disabled).toEqual({ code: 0, stdout: `Disabled adc in ${path.join(project, "overlay.dtso")}\n`, stderr: "" });
        expect(fs.readFileSync(path.join(project, "overlay.dtso"), "utf8")).toMatch(/adc: adc@0 \{\n(.*\n)*\t{4}status = "disabled";/);

        const missing = await run(["--json", "enable", "nope"]);
        expect(JSON.parse(missing.stdout)).toEqual({ ok: false, message: "Not found: nope", severity: "error" });
        expect(await run(["--json", "enable"])).toMatchObject({ code: 2, stdout: "", stderr: "Missing: path\n" });
    });

    test("--json list parent: the valid buses of the base, label and path; no binding a warning", async () => {
        configure();
        const parents = await run(["--json", "list", "parent", "adi,ad7124-8"]);
        expect(parents.code).toBe(0);
        expect(JSON.parse(parents.stdout)).toEqual({
            ok: true, message: "Found 1 valid parents", severity: "info",
            suggestions: [{ value: "spi0", display_string: "/soc/spi@7e204000" }],
        });
        expect(await run(["list", "parent", "adi,ad7124-8"])).toMatchObject({ stdout: "spi0  /soc/spi@7e204000\n" });
        const unknown = await run(["--json", "list", "parent", "adi,nope"]);
        expect(JSON.parse(unknown.stdout)).toEqual({ ok: true, message: "No binding found for adi,nope", severity: "warn", suggestions: [] });
    });

    test("--json list overlay: the overlays of the tree with the device, graded against the board", async () => {
        configure();
        const overlays = path.join(linux, "arch", "arm", "boot", "dts", "overlays");
        fs.mkdirSync(overlays, { recursive: true });
        fs.writeFileSync(path.join(overlays, "ad7124-overlay.dts"), OVERLAY_FILE);
        const listed = await run(["--json", "list", "overlay", "adi,ad7124-8"]);
        expect(listed.code).toBe(0);
        expect(JSON.parse(listed.stdout)).toEqual({
            ok: true, message: "1 overlays with adi,ad7124-8", severity: "info",
            overlays: [{ name: "ad7124-overlay.dts", path: path.join(overlays, "ad7124-overlay.dts"), fit: "incompatible", reason: "overlay: brcm,bcm2835; base: " }],
        });
        expect(await run(["list", "overlay", "adi,ad7124-8"])).toMatchObject({ stdout: "ad7124-overlay.dts  incompatible (overlay: brcm,bcm2835; base: )\n" });
        expect(await run(["list", "overlay", "adi,adxl000"])).toMatchObject({ stdout: `No overlay in ${linux} has adi,adxl000\n` });
    });

    test("the bare run: the backend's setup asks the tree, the base and the workfile's name, then init creates it", async () => {
        write_settings({});
        write_caches();
        const prompter = scripted([linux, "manual", path.join(base, "base.dts"), "board"]);
        const setup_registry: Registry = { linux: () => import("./index").then(module => ({ ...module.backend, setup: create_setup({ home: base }) })) };
        const result = await run([], { prompter, registry: setup_registry });
        expect(result.code).toBe(0);
        expect(prompter.asked).toEqual(["Linux source tree", "Choose how to select the base .dts file", "Path to .dts file", "Overlay file name"]);
        expect(result.stdout).toContain("Saved linux, devicetree and workfile to .analog-attach/config.json.\n");
        expect(result.stdout).toContain(`Overlay:     ${path.join(project, "board.dtso")} (created)`);
        expect(result.stdout).not.toContain("Create the workfile:");
        expect(fs.readFileSync(path.join(project, "board.dtso"), "utf8")).toContain("/plugin/;");
        expect(JSON.parse(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8"))).toEqual({
            backend: "linux", linux: { linux, devicetree: path.join(base, "base.dts"), workfile: path.join(project, "board.dtso") },
        });
    });

    test("the bare run: Ctrl-C in the setup saves nothing, exit 130; a settings file that isn't JSON stops it before a question, exit 2", async () => {
        write_settings({});
        const prompter = scripted([]);
        const setup_registry: Registry = { linux: () => import("./index").then(module => ({ ...module.backend, setup: create_setup({ home: base }) })) };
        const stopped = await run([], { prompter, registry: setup_registry });
        expect(stopped.code).toBe(130);
        expect(stopped.stdout).toMatch(/Setup cancelled\.\n$/);
        expect(JSON.parse(fs.readFileSync(path.join(project, ".analog-attach", "config.json"), "utf8"))).toEqual({ backend: "linux", linux: {} });

        fs.writeFileSync(path.join(project, ".analog-attach", "config.json"), "{ nope");
        const broken = scripted([]);
        const result = await run([], { prompter: broken, registry: setup_registry });
        expect(result.code).toBe(2);
        expect(broken.asked).toEqual([]);
        expect(result.stderr).toContain("not JSON");

        // Nor can it save into a linux section that isn't an object: an old flat file.
        fs.writeFileSync(path.join(project, ".analog-attach", "config.json"), JSON.stringify({ backend: "linux", linux, devicetree: path.join(base, "base.dts") }));
        const flat = scripted([]);
        const refused = await run([], { prompter: flat, registry: setup_registry });
        expect(refused.code).toBe(2);
        expect(flat.asked).toEqual([]);
        expect(refused.stderr).toContain(".analog-attach/config.json: linux: must be an object");
    });
});
