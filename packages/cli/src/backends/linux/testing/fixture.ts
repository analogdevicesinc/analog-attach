// A tiny Linux workspace for the backend's tests through the front end's `main`: a fixture
// Linux tree with two bindings, a base devicetree, an overlay, caches and a bundled
// dt-schema in temp directories, so nothing depends on a real kernel checkout.

import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { main } from "../../../front/main";
import { capture_stream } from "../../../front/output";
import type { Registry } from "../../../front/registry";
import { PromptCancelled, type Prompter } from "../../../interface/backend-interface";

export const LINUX_REGISTRY: Registry = { linux: () => import("../index").then(module => module.backend) };

export const BASE_DTS = `/dts-v1/;
/ {
\tsoc {
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tspi0: spi@7e204000 {
\t\t\tcompatible = "brcm,bcm2835-spi";
\t\t\t#address-cells = <1>;
\t\t\t#size-cells = <0>;
\t\t\tstatus = "disabled";
\t\t};
\t};
};
`;

export const OVERLAY = `/dts-v1/;
/plugin/;

&spi0 {
\tstatus = "okay";
\tadc: adc@0 {
\t\tcompatible = "adi,ad7124-8";
\t\treg = <0>;
\t};
};
`;

/** A binding of the fixture Linux tree: two compatibles, and channel child nodes with required properties. */
export const AD7124_YAML = `%YAML 1.2
---
$id: http://devicetree.org/schemas/iio/adc/adi,ad7124.yaml#
$schema: http://devicetree.org/meta-schemas/core.yaml#

title: Analog Devices AD7124 ADC

properties:
  compatible:
    enum:
      - adi,ad7124-4
      - adi,ad7124-8
  reg:
    maxItems: 1
  spi-max-frequency:
    maximum: 5000000
  interrupts:
    maxItems: 1
  '#address-cells':
    const: 1
  '#size-cells':
    const: 0

required:
  - compatible
  - reg

patternProperties:
  "^channel@([0-9]|1[0-5])$":
    type: object
    properties:
      reg:
        maxItems: 1
      diff-channels:
        maxItems: 2
        minItems: 2
      bipolar:
        type: boolean
    required:
      - reg
      - diff-channels

additionalProperties: false
`;

/** A second binding of the fixture tree: an SPI device with required properties add leaves to the interview. */
export const ADXL_YAML = `%YAML 1.2
---
$id: http://devicetree.org/schemas/iio/accel/adi,adxl000.yaml#
$schema: http://devicetree.org/meta-schemas/core.yaml#

title: Analog Devices ADXL000 accelerometer

properties:
  compatible:
    const: adi,adxl000
  reg:
    maxItems: 1
  adi,mode:
    enum:
      - fast
      - slow
  spi-max-frequency:
    maximum: 5000000

required:
  - compatible
  - reg
  - adi,mode
  - spi-max-frequency

additionalProperties: false
`;

/** An overlay file to import: one fragment on spi0, and a reference to a node nobody has. */
export const IMPORTED = `/dts-v1/;
/plugin/;
/ {
\tfragment@0 {
\t\ttarget = <&spi0>;
\t\t__overlay__ {
\t\t\tstatus = "okay";
\t\t\tdac@1 {
\t\t\t\treg = <1>;
\t\t\t\tvref-supply = <&vref>;
\t\t\t};
\t\t};
\t};
};
`;

/** A prompter without a terminal that answers from a script, in order, and records the questions; Ctrl-C once the script runs out. */
export function scripted(answers: unknown[]): Prompter & { asked: string[] } {
    const asked: string[] = [];
    const next = <T>(message: string): Promise<T> => {
        asked.push(message);
        if (answers.length === 0) { return Promise.reject(new PromptCancelled()); }
        return Promise.resolve(answers.shift() as T);
    };
    return {
        asked,
        select: question => next(question.message),
        input: question => next(question.message),
        confirm: question => next(question.message),
        checkbox: question => next(question.message),
        search: question => next(question.message),
    };
}

export interface RunOptions {
    /** A run on a terminal, asking through this prompter. */
    prompter?: Prompter;
    registry?: Registry;
}

export interface RunResult { code: number; stdout: string; stderr: string }

export interface LinuxFixture {
    /** The temp directory everything is in. */
    readonly base: string;
    /** The cwd of a run, with `overlay.dtso`. */
    readonly project: string;
    readonly home: string;
    /** A package root with an (empty) bundled dt-schema. */
    readonly package_root: string;
    /** The fixture Linux tree. */
    readonly linux: string;
    /** The project's state directory, where the Linux backend keeps its caches. */
    state_directory(): string;
    /** `.analog-attach/config.json` with `backend: linux` and these values. */
    write_settings(values: Record<string, string>): void;
    /** A binding YAML in the Linux tree, under `Documentation/devicetree/bindings/<relative>`, for `compatibles`; in the caches `write_caches` writes next. */
    write_binding(relative: string, yaml: string, compatibles: readonly string[]): void;
    /** Caches as `config linux` would leave them, current for the fixture tree. */
    write_caches(): void;
    /** A configured workspace with current caches. */
    configure(): void;
    /** One run of `main` in the project. */
    run(argv: readonly string[], options?: RunOptions): Promise<RunResult>;
    remove(): void;
}

/** A fresh fixture: the Linux tree with the ad7124 and adxl000 bindings, the base, the overlay; nothing configured yet. */
export function create_linux_fixture(): LinuxFixture {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aa-linux-")));
    const project = path.join(base, "project");
    const home = path.join(base, "home");
    const package_root = path.join(base, "package");
    const linux = path.join(base, "linux");
    const bindings_directory = path.join(linux, "Documentation", "devicetree", "bindings");
    const entries: Record<string, string> = {};

    fs.mkdirSync(project);
    fs.mkdirSync(home);
    for (const directory of ["schemas", "meta-schemas"]) {
        fs.mkdirSync(path.join(package_root, "bundled", "linux", "dt-schema", "dtschema", directory), { recursive: true });
    }
    fs.mkdirSync(bindings_directory, { recursive: true });
    fs.mkdirSync(path.join(linux, "include"), { recursive: true });
    fs.writeFileSync(path.join(base, "base.dts"), BASE_DTS);
    fs.writeFileSync(path.join(project, "overlay.dtso"), OVERLAY);

    const state_directory = (): string => path.join(project, ".analog-attach", "linux");
    const write_binding = (relative: string, yaml: string, compatibles: readonly string[]): void => {
        const file = path.join(bindings_directory, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, yaml);
        for (const compatible of compatibles) { entries[compatible] = file; }
    };
    write_binding(path.join("iio", "adc", "adi,ad7124.yaml"), AD7124_YAML, ["adi,ad7124-4", "adi,ad7124-8"]);
    write_binding(path.join("iio", "accel", "adi,adxl000.yaml"), ADXL_YAML, ["adi,adxl000"]);

    const fixture: LinuxFixture = {
        base, project, home, package_root, linux,
        state_directory,
        write_settings(values) {
            fs.mkdirSync(path.join(project, ".analog-attach"), { recursive: true });
            fs.writeFileSync(path.join(project, ".analog-attach", "config.json"), JSON.stringify({ backend: "linux", ...values }, undefined, 2));
        },
        write_binding,
        write_caches() {
            const dt_schema = path.join(package_root, "bundled", "linux", "dt-schema");
            const stamp = { generated_at: Date.now() + 60_000, linux, dt_schema };
            fs.mkdirSync(state_directory(), { recursive: true });
            fs.writeFileSync(path.join(state_directory(), "compat-index.json"), JSON.stringify({ ...stamp, entries }));
            fs.writeFileSync(path.join(state_directory(), "validation.json"), "{}");
            fs.writeFileSync(path.join(state_directory(), "validation.stamp.json"), JSON.stringify(stamp));
        },
        configure() {
            fixture.write_settings({ linux, devicetree: path.join(base, "base.dts"), workfile: path.join(project, "overlay.dtso") });
            fixture.write_caches();
        },
        async run(argv, options = {}) {
            const tty = options.prompter !== undefined;
            const stdout = capture_stream(false);
            const stderr = capture_stream(false);
            const code = await main(argv, {
                registry: options.registry ?? LINUX_REGISTRY,
                streams: { stdout, stderr },
                location: { cwd: project, home, xdg_config_home: path.join(home, ".config") },
                tty: { stdin: tty, stdout: tty },
                ...(options.prompter === undefined ? {} : { prompter: () => options.prompter! }),
                environment: {},
                claude_installed: () => false,
                package_root,
            });
            return { code, stdout: stdout.text, stderr: stderr.text };
        },
        remove() {
            fs.rmSync(base, { recursive: true, force: true });
        },
    };
    return fixture;
}
