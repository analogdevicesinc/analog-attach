// The contract between the front end and every backend of the registry (front/registry.ts),
// generalising attach-cli's completion drift test:
//
//   - every shared route is implemented, or answers "not supported by the <id> backend";
//   - every backend flag reaches its route, and every completion slot of a positional or of
//     a flag's value reaches the backend's `complete`, which answers without throwing;
//   - every `ExtraCommand.schema` is a file of docs/spec/04-protocol;
//   - the `--json` output of each command, run through `main` in a fixture workspace,
//     validates against the 04-protocol schemas: a shared command's against the backend's
//     `$defs/<id>` and the root, an extra's and a front-end command's against its own
//     schema, a configuration error on stderr against config-error.schema.json. Each shared
//     and extra command has an answer and a refusal (or configuration error) among them.
//
// Neither backend needs a real checkout: Linux runs in the tiny Linux tree of
// backends/linux/testing/fixture.ts, with shell stand-ins for the bundled tools and sshpass;
// no-OS in attach-no-os-lib's fixtures (backends/noos/testing/fixture.ts).

import * as fs from "node:fs";
import path from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { BACKENDS, type Registry } from "./front/registry";
import { build_routes, SHARED_ROUTES, type FrontEnd, type Route } from "./front/routes";
import type { Backend, Commands, Completion, ExtraCommand, Slot } from "./interface/backend-interface";
import { BASE_DTS, create_linux_fixture, IMPORTED, type LinuxFixture } from "./backends/linux/testing/fixture";
import { create_noos_fixture, FIXTURES, type NoosFixture } from "./backends/noos/testing/fixture";

const PROTOCOL = path.resolve(import.meta.dirname, "../docs/spec/04-protocol");

// =====================================================================================
// The schemas
// =====================================================================================

let ajv: Ajv2020;

beforeAll(() => {
    ajv = new Ajv2020({ allErrors: true, strict: false });
    for (const file of fs.readdirSync(PROTOCOL).filter(name => name.endsWith(".schema.json"))) {
        ajv.addSchema(JSON.parse(fs.readFileSync(path.join(PROTOCOL, file), "utf8")) as object);
    }
});

/** Ajv's errors for `data` against `reference` (`read.schema.json#/$defs/linux`); empty when it validates. */
function schema_errors(data: unknown, reference: string): string[] {
    const validate: ValidateFunction | undefined = ajv.getSchema(reference);
    if (validate === undefined) { return [`no schema ${reference}`]; }
    if (validate(data)) { return []; }
    return (validate.errors ?? []).slice(0, 8).map(error => `${error.instancePath || "/"} ${error.message ?? ""} ${JSON.stringify(error.params)}`);
}

// =====================================================================================
// What the cases are
// =====================================================================================

interface RunResult { code: number; stdout: string; stderr: string }

/** A fixture workspace: one run of `main` in its project. */
interface Harness {
    /** The project's `.analog-attach/config.json`. */
    readonly settings_file: string;
    run(argv: readonly string[], options?: { registry?: Registry }): Promise<RunResult>;
    remove(): void;
}

/**
 * One `--json` run. `shape` is what it must show: an answer (exit 0, `ok` true where the
 * response has one), a refusal (exit 0, `ok: false`), or a configuration error (exit 2, JSON
 * on stderr, nothing on stdout).
 */
interface Case<F extends Harness> {
    /** The route it runs: `list devices`, `move`, `config`. */
    readonly route: string;
    readonly argv: readonly string[];
    readonly shape: "answer" | "refusal" | "config-error";
    readonly prepare?: (fixture: F) => void | Promise<void>;
}

/** The front end's own commands: their schemas, validated at the root. */
const FRONT_SCHEMAS: Readonly<Record<string, string>> = {
    "config": "config.schema.json",
    "completion": "completion.schema.json",
    "skill install": "skill.schema.json",
    "skill uninstall": "skill.schema.json",
};

const schema_file = (route: string): string => `${route.replaceAll(" ", "-")}.schema.json`;

/** The schema references a case's output must validate against. */
function references(backend: Backend, kase: Case<Harness>): string[] {
    if (kase.shape === "config-error") { return ["config-error.schema.json"]; }
    if (SHARED_ROUTES.includes(kase.route)) { return [`${schema_file(kase.route)}#/$defs/${backend.id}`, schema_file(kase.route)]; }
    const extra = backend.extra?.[kase.route];
    if (extra !== undefined) { return [extra.schema]; }
    const front = FRONT_SCHEMAS[kase.route];
    if (front !== undefined) { return [front]; }
    throw new Error(`No schema for the route '${kase.route}'`);
}

/** The backend's implementation of a shared route, if it has one. */
function implementation_of(commands: Commands, route: string): { flags?: Readonly<Record<string, unknown>> } | undefined {
    switch (route) {
        case "list devices": { return commands.list?.devices; }
        case "list context": { return commands.list?.context; }
        case "list property": { return commands.list?.property; }
        case "list value": { return commands.list?.value; }
        default: { return commands[route as Exclude<keyof Commands, "list">]; }
    }
}

/** The routes of a run with `backend` active, as `main` builds them. */
function routes_of(backend: Backend, registry: Registry): Route[] {
    return build_routes({ program: "analog-attach", backend, registry, home: "/home/nobody", environment: {} } as unknown as FrontEnd);
}

const FRONT_ROUTES = new Set(["config", "completion", "skill"]);

/** A local settings file that isn't JSON. */
const broken_settings = (fixture: { settings_file: string }): void => { fs.writeFileSync(fixture.settings_file, "{"); };

// =====================================================================================
// The contract, for one backend
// =====================================================================================

interface Contract<F extends Harness> {
    readonly id: string;
    /** A fresh workspace, configured for the backend unless a case's `prepare` says otherwise. */
    create(): F;
    readonly cases: readonly Case<F>[];
    /** A word for each positional typed before the one completed, by positional name. */
    readonly sample: Readonly<Record<string, string>>;
    /** Prepares the workspace the completion runs in. */
    readonly prepare_completion: (fixture: F) => void | Promise<void>;
}

/** The ids `check_contract` has run for, so a backend added to the registry without a contract fails. */
const CHECKED: string[] = [];

function check_contract<F extends Harness>(contract: Contract<F>): void {
    CHECKED.push(contract.id);
    describe(`the ${contract.id} backend`, () => {
        let backend: Backend;
        let fixture: F | undefined;
        const fresh = (): F => {
            fixture = contract.create();
            return fixture;
        };

        beforeAll(async () => {
            const loader = BACKENDS[contract.id];
            if (loader === undefined) { throw new Error(`${contract.id} is not in the registry`); }
            backend = await loader();
        });

        afterEach(() => {
            fixture?.remove();
            fixture = undefined;
        });

        test("is registered under its id", () => {
            expect(backend.id).toBe(contract.id);
        });

        test("every shared route is implemented, or answers that it is not supported", async () => {
            const routes = routes_of(backend, BACKENDS);
            const workspace = fresh();
            for (const name of SHARED_ROUTES) {
                const route = routes.find(candidate => candidate.path.join(" ") === name);
                expect(route, name).toBeDefined();
                const implemented = implementation_of(backend.commands, name) !== undefined;
                expect(route!.supported, name).toBe(implemented);
                if (implemented) { continue; }
                const words = route!.positionals.filter(positional => positional.optional !== true && positional.variadic !== true).map(() => "x");
                for (const json of [[], ["--json"]]) {
                    const result = await workspace.run([...json, ...route!.path, ...words]);
                    expect(result, name).toEqual({ code: 2, stdout: "", stderr: `${name} is not supported by the ${contract.id} backend\n` });
                }
            }
        });

        test("every backend flag is on its route, and none is the front end's", () => {
            const routes = routes_of(backend, BACKENDS);
            const flags_of = (name: string): readonly string[] => Object.keys(routes.find(route => route.path.join(" ") === name)?.flags ?? {});
            for (const name of SHARED_ROUTES) {
                for (const flag of Object.keys(implementation_of(backend.commands, name)?.flags ?? {})) {
                    expect(flags_of(name), `${name} --${flag}`).toContain(flag);
                }
            }
            for (const [name, extra] of Object.entries(backend.extra ?? {})) {
                expect(SHARED_ROUTES, name).not.toContain(name);
                for (const flag of Object.keys(extra.flags ?? {})) {
                    expect(flags_of(name), `${name} --${flag}`).toContain(flag);
                }
            }
        });

        test("every extra command's schema is a file of 04-protocol", () => {
            for (const [name, extra] of Object.entries(backend.extra ?? {}) as [string, ExtraCommand][]) {
                expect(fs.existsSync(path.join(PROTOCOL, extra.schema)), `${name}: ${extra.schema}`).toBe(true);
                expect(ajv.getSchema(extra.schema), `${name}: ${extra.schema}`).toBeDefined();
            }
        });

        test("every completion slot of a positional or a flag's value reaches complete, which answers", async () => {
            const slots: Slot[] = [];
            const errors: unknown[] = [];
            const recording: Backend = {
                ...backend,
                async complete(slot, partial, session): Promise<Completion> {
                    slots.push(slot);
                    try {
                        return await backend.complete(slot, partial, session);
                    } catch (error) {
                        errors.push(error);
                        throw error;
                    }
                },
            };
            const registry: Registry = { [contract.id]: () => Promise.resolve(recording) };
            const workspace = fresh();
            await contract.prepare_completion(workspace);
            const complete = async (words: readonly string[]): Promise<void> => {
                const result = await workspace.run(["__complete", "--", ...words], { registry });
                expect(result.code, words.join(" ")).toBe(0);
                expect(result.stderr, words.join(" ")).toBe("");
            };

            const routes = routes_of(recording, registry).filter(route => route.supported && route.complete === undefined && !FRONT_ROUTES.has(route.path[0]!));
            let asked = 0;
            for (const route of routes) {
                const name = route.path.join(" ");
                for (const [index, positional] of route.positionals.entries()) {
                    if (positional.slot === undefined) { continue; }
                    const prior = route.positionals.slice(0, index).map(spec => contract.sample[spec.name] ?? "x");
                    slots.length = 0;
                    await complete([...route.path, ...prior, ""]);
                    expect(slots, `${name} <${positional.name}>`).toEqual([positional.slot(prior)]);
                    asked += 1;
                }
                for (const [flag, spec] of Object.entries(route.flags)) {
                    if (spec.kind === "boolean") { continue; }
                    slots.length = 0;
                    await complete([...route.path, `--${flag}`, ""]);
                    expect(slots, `${name} --${flag}`).toEqual([{ kind: "flag", command: name, flag, prior: [] }]);
                    asked += 1;
                }
            }
            expect(errors).toEqual([]);
            expect(asked).toBeGreaterThan(0);
        });

        test("each shared and extra command has an answer and a refusal among the cases", () => {
            const routes = [
                ...SHARED_ROUTES.filter(name => implementation_of(backend.commands, name) !== undefined),
                ...Object.keys(backend.extra ?? {}),
            ];
            for (const name of routes) {
                const shapes = new Set(contract.cases.filter(kase => kase.route === name).map(kase => kase.shape));
                expect(shapes.has("answer"), `${name}: an answer`).toBe(true);
                expect(shapes.has("refusal") || shapes.has("config-error"), `${name}: a refusal`).toBe(true);
            }
        });

        describe("--json output validates against the 04-protocol schemas", () => {
            for (const kase of contract.cases) {
                test(`${kase.argv.join(" ")}: ${kase.shape}`, async () => {
                    const workspace = fresh();
                    await kase.prepare?.(workspace);
                    const result = await workspace.run(["--json", ...kase.argv]);
                    const label = `${kase.argv.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;
                    let response: unknown;
                    if (kase.shape === "config-error") {
                        expect(result.code, label).toBe(2);
                        expect(result.stdout, label).toBe("");
                        response = JSON.parse(result.stderr);
                    } else {
                        expect(result.code, label).toBe(0);
                        response = JSON.parse(result.stdout);
                        const ok = (response as { ok?: unknown }).ok;
                        if (kase.shape === "refusal") { expect(ok, label).toBe(false); }
                        if (kase.shape === "answer" && ok !== undefined) { expect(ok, label).toBe(true); }
                    }
                    for (const reference of references(backend, kase as Case<Harness>)) {
                        expect(schema_errors(response, reference), `${reference}\n${label}`).toEqual([]);
                    }
                });
            }
        });
    });
}

// =====================================================================================
// Linux
// =====================================================================================

/**
 * A stand-in for dtc, dt-mk-schema and dt-validate: prints a version, writes the file after `-o`
 * or `--json-output` (`diagnostics.json` next to it, else `[]`), and fails when a file named
 * `fail` is next to it.
 */
const FAKE_TOOL = `#!/bin/sh
here=$(dirname "$0")
if [ "$1" = "--version" ]; then echo "fake 1.0"; exit 0; fi
if [ -e "$here/fail" ]; then echo "fake failure: $(basename "$0")" >&2; exit 1; fi
previous=""
for word in "$@"; do
    case "$previous" in
        -o|--json-output)
            if [ -e "$here/diagnostics.json" ]; then cat "$here/diagnostics.json" > "$word"; else printf '[]' > "$word"; fi ;;
    esac
    previous="$word"
done
exit 0
`;

/** A stand-in for sshpass and scp: writes nothing, and fails when a file named `fail` is next to it. */
const FAKE_COPY = `#!/bin/sh
if [ -e "$(dirname "$0")/fail" ]; then echo "fake failure: $(basename "$0")" >&2; exit 1; fi
exit 0
`;

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

/** A diagnostic as dt-validate writes it with --json-output. */
const DIAGNOSTIC = [{
    type: "error", level: "error", node: "/node0/adc@0", property_path: ["spi-max-frequency"],
    message: "99999999 is greater than the maximum of 5000000", formatted: "/node0/adc@0: spi-max-frequency: 99999999 is greater than the maximum of 5000000",
}];

interface LinuxHarness extends Harness {
    readonly linux: LinuxFixture;
    /** The fake tools in the bundled tools directory; `fail` makes them fail. */
    tools(options?: { fail?: boolean; diagnostics?: unknown[] }): void;
    /** A fake `sshpass` (and `scp`, which deploy checks for) first on PATH, until the test ends. */
    sshpass(options?: { fail?: boolean }): void;
    /** The RPi overlay that adds an ad7124-8, in the tree's overlay directory. */
    overlays(): void;
}

const original_path = process.env["PATH"];

function create_linux_harness(): LinuxHarness {
    const linux = create_linux_fixture();
    linux.configure();
    const write_tool = (directory: string, name: string, fail: boolean, script = FAKE_TOOL): void => {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, name), script, { mode: 0o755 });
        if (fail) { fs.writeFileSync(path.join(directory, "fail"), ""); }
    };
    return {
        linux,
        settings_file: path.join(linux.project, ".analog-attach", "config.json"),
        run: (argv, options = {}) => linux.run(argv, options),
        remove() {
            process.env["PATH"] = original_path;
            linux.remove();
        },
        tools({ fail = false, diagnostics } = {}) {
            const directory = path.join(linux.package_root, "bundled", "linux", "tools");
            for (const name of ["dtc", "dt-mk-schema", "dt-validate"]) { write_tool(directory, name, fail); }
            if (diagnostics !== undefined) { fs.writeFileSync(path.join(directory, "diagnostics.json"), JSON.stringify(diagnostics)); }
        },
        sshpass({ fail = false } = {}) {
            const directory = path.join(linux.base, "bin");
            write_tool(directory, "sshpass", fail, FAKE_COPY);
            write_tool(directory, "scp", false, FAKE_COPY);
            process.env["PATH"] = `${directory}${path.delimiter}${original_path ?? ""}`;
        },
        overlays() {
            const directory = path.join(linux.linux, "arch", "arm", "boot", "dts", "overlays");
            fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(path.join(directory, "ad7124-overlay.dts"), OVERLAY_FILE);
        },
    };
}

const unconfigured = (fixture: LinuxHarness): void => { fixture.linux.write_settings({}); };
const with_spi1 = (fixture: LinuxHarness): void => { fs.writeFileSync(path.join(fixture.linux.base, "base.dts"), BASE_WITH_SPI1); };
/** The deploy settings, and the .dtbo `build` would have written. */
const deploy_settings = (fixture: LinuxHarness): void => {
    const { linux } = fixture;
    fs.writeFileSync(path.join(linux.project, "overlay.dtbo"), "");
    linux.write_settings({
        "linux": linux.linux, "devicetree": path.join(linux.base, "base.dts"), "workfile": path.join(linux.project, "overlay.dtso"),
        "deploy-ip": "192.0.2.1", "deploy-user": "pi", "deploy-password": "secret",
    });
};

const LINUX_CASES: readonly Case<LinuxHarness>[] = [
    { route: "init", argv: ["init"], shape: "answer" },
    {
        route: "init", argv: ["init"], shape: "answer",
        prepare: fixture => {
            const { linux } = fixture;
            linux.write_settings({ linux: linux.linux, devicetree: path.join(linux.base, "base.dts"), workfile: path.join(linux.project, "new.dtso") });
        },
    },
    {
        route: "init", argv: ["init"], shape: "refusal",
        prepare: fixture => {
            const { linux } = fixture;
            const workfile = path.join(linux.project, "folder.dtso");
            fs.mkdirSync(workfile);
            linux.write_settings({ linux: linux.linux, devicetree: path.join(linux.base, "base.dts"), workfile });
        },
    },
    { route: "init", argv: ["init"], shape: "config-error", prepare: unconfigured },

    { route: "import", argv: ["import", "extra-overlay.dts"], shape: "answer", prepare: fixture => { fs.writeFileSync(path.join(fixture.linux.project, "extra-overlay.dts"), IMPORTED); } },
    { route: "import", argv: ["import", "ad7124-overlay.dts"], shape: "answer", prepare: fixture => { fixture.overlays(); } },
    { route: "import", argv: ["import", "nope-overlay.dts"], shape: "refusal" },

    { route: "add", argv: ["add", "adi,adxl000"], shape: "answer" },
    { route: "add", argv: ["add", "adi,ad7124-4", "--parent", "spi0", "--name", "adc@3", "--label", "second"], shape: "answer" },
    { route: "add", argv: ["add", "adi,ad7124-8", "--template", "overlay:ad7124", "--parent", "spi1"], shape: "answer", prepare: fixture => { with_spi1(fixture); fixture.overlays(); } },
    { route: "add", argv: ["add", "adi,ad7124-4", "--parent", "spi0", "--name", "adc@0"], shape: "refusal" },
    { route: "add", argv: ["add", "adi,nope"], shape: "refusal" },

    { route: "read", argv: ["read"], shape: "answer" },
    { route: "read", argv: ["read", "spi0"], shape: "answer" },
    { route: "read", argv: ["read", "adc", "reg"], shape: "answer" },
    { route: "read", argv: ["read", "adc", "spi-max-frequency"], shape: "refusal" },
    { route: "read", argv: ["read", "nope"], shape: "refusal" },
    { route: "read", argv: ["read", "spi0"], shape: "config-error", prepare: unconfigured },

    { route: "update", argv: ["update", "adc", "spi-max-frequency", "1000000"], shape: "answer" },
    { route: "update", argv: ["update", "adc", "interrupts", "25", "8"], shape: "answer" },
    { route: "update", argv: ["update", "adc", "reg"], shape: "answer" },
    { route: "update", argv: ["update", "adc", "channel@0"], shape: "answer" },
    { route: "update", argv: ["update", "spi0", "status", "disabled"], shape: "answer" },
    { route: "update", argv: ["update", "nope", "status", "okay"], shape: "refusal" },

    { route: "delete", argv: ["delete", "adc", "reg"], shape: "answer" },
    { route: "delete", argv: ["delete", "adc"], shape: "answer" },
    {
        route: "delete", argv: ["delete", "adc"], shape: "answer",
        prepare: async fixture => { await fixture.run(["update", "adc", "channel@0"]); },
    },
    { route: "delete", argv: ["delete", "spi0"], shape: "refusal" },
    { route: "delete", argv: ["delete", "adc", "nope"], shape: "refusal" },

    { route: "rename", argv: ["rename", "adc", "adc@1"], shape: "answer" },
    { route: "rename", argv: ["rename", "/", "top"], shape: "refusal" },
    { route: "rename", argv: ["rename", "spi0", "spi1"], shape: "refusal" },

    { route: "list devices", argv: ["list", "devices"], shape: "answer" },
    { route: "list devices", argv: ["list", "devices", "ad7124"], shape: "answer" },
    { route: "list devices", argv: ["list", "devices", "adi,ad7124-8"], shape: "answer" },
    { route: "list devices", argv: ["list", "devices"], shape: "config-error", prepare: unconfigured },

    { route: "list property", argv: ["list", "property", "adc"], shape: "answer" },
    { route: "list property", argv: ["list", "property", "adc", "reg"], shape: "answer" },
    { route: "list property", argv: ["list", "property", "nope"], shape: "refusal" },

    { route: "list value", argv: ["list", "value", "adc", "compatible"], shape: "answer" },
    { route: "list value", argv: ["list", "value", "adc", "spi-max-frequency"], shape: "answer" },
    { route: "list value", argv: ["list", "value", "nope", "reg"], shape: "refusal" },

    { route: "validate", argv: ["validate"], shape: "answer", prepare: fixture => { fixture.tools(); } },
    { route: "validate", argv: ["validate"], shape: "answer", prepare: fixture => { fixture.tools({ diagnostics: DIAGNOSTIC }); } },
    { route: "validate", argv: ["validate"], shape: "answer", prepare: fixture => { fixture.tools({ fail: true }); } },
    { route: "validate", argv: ["validate"], shape: "config-error" },

    { route: "build", argv: ["build"], shape: "answer", prepare: fixture => { fixture.tools(); } },
    { route: "build", argv: ["build"], shape: "refusal", prepare: fixture => { fixture.tools({ fail: true }); } },
    { route: "build", argv: ["build"], shape: "config-error" },

    { route: "deploy", argv: ["deploy"], shape: "answer", prepare: fixture => { deploy_settings(fixture); fixture.sshpass(); } },
    { route: "deploy", argv: ["deploy"], shape: "refusal", prepare: fixture => { deploy_settings(fixture); fixture.sshpass({ fail: true }); } },
    { route: "deploy", argv: ["deploy"], shape: "config-error" },

    { route: "move", argv: ["move", "adc", "spi1"], shape: "answer", prepare: with_spi1 },
    { route: "move", argv: ["move", "adc", "adc"], shape: "refusal" },
    { route: "move", argv: ["move", "adc", "i2c9"], shape: "refusal" },

    { route: "enable", argv: ["enable", "spi0"], shape: "answer" },
    { route: "enable", argv: ["enable", "nope"], shape: "refusal" },
    { route: "disable", argv: ["disable", "adc"], shape: "answer" },
    { route: "disable", argv: ["disable", "nope"], shape: "refusal" },

    { route: "list parent", argv: ["list", "parent", "adi,ad7124-8"], shape: "answer" },
    { route: "list parent", argv: ["list", "parent", "adi,nope"], shape: "answer" },
    { route: "list parent", argv: ["list", "parent", "adi,ad7124-8"], shape: "config-error", prepare: unconfigured },

    { route: "list overlay", argv: ["list", "overlay", "adi,ad7124-8"], shape: "answer", prepare: fixture => { fixture.overlays(); } },
    { route: "list overlay", argv: ["list", "overlay", "adi,adxl000"], shape: "answer" },
    { route: "list overlay", argv: ["list", "overlay", "adi,ad7124-8"], shape: "config-error", prepare: unconfigured },

    { route: "config", argv: ["config"], shape: "answer" },
    { route: "config", argv: ["config", "workfile"], shape: "answer" },
    { route: "config", argv: ["config", "overlay-syntax", "label"], shape: "answer" },
    { route: "config", argv: ["config", "overlay-syntax", "--reset"], shape: "answer" },
    { route: "config", argv: ["config", "workfile", "new.dtso"], shape: "answer" },
    { route: "config", argv: ["config", "--reload"], shape: "answer", prepare: fixture => { fixture.tools(); } },
    { route: "config", argv: ["config", "--reload"], shape: "refusal", prepare: fixture => { fixture.tools({ fail: true }); } },
    { route: "config", argv: ["config"], shape: "config-error", prepare: broken_settings },
    { route: "completion", argv: ["completion", "bash"], shape: "answer" },
    { route: "completion", argv: ["completion", "zsh", "--install"], shape: "answer" },
    { route: "skill install", argv: ["skill", "install", "analog-attach-linux"], shape: "refusal" },
    { route: "skill uninstall", argv: ["skill", "uninstall", "analog-attach-linux"], shape: "refusal" },
];

check_contract<LinuxHarness>({
    id: "linux",
    create: create_linux_harness,
    cases: LINUX_CASES,
    sample: {
        path: "spi0/adc@0", property: "compatible", values: "1", device: "adi,ad7124-8", filter: "adi", compatible: "adi,ad7124-8",
        source: "ad7124-overlay.dts", destination: "spi0", name: "adc2", member: "x",
    },
    prepare_completion: fixture => { fixture.overlays(); },
});

// =====================================================================================
// no-OS
// =====================================================================================

interface NoosHarness extends Harness {
    readonly noos: NoosFixture;
    /** The workfile with the test part on its eval board. */
    sensor(): Promise<void>;
    /** A project directory for build and deploy, with `command` as their build-command and deploy-command. */
    project(command: string): Promise<void>;
}

function create_noos_harness(): NoosHarness {
    const noos = create_noos_fixture();
    noos.settings();
    // What the build copies into bundled/noos/templates: the lib's own templates.
    const templates = path.join(noos.base, "package", "bundled", "noos", "templates");
    fs.mkdirSync(path.dirname(templates), { recursive: true });
    fs.symlinkSync(path.join(FIXTURES, "..", "..", "src", "codegen", "templates"), templates);
    const harness: NoosHarness = {
        noos,
        settings_file: path.join(noos.project, ".analog-attach", "config.json"),
        run: (argv, options = {}) => noos.run(argv, options),
        remove() { noos.remove(); },
        sensor: () => noos.sensor(),
        async project(command) {
            await noos.sensor();
            const directory = path.join(noos.base, "app");
            fs.mkdirSync(path.join(directory, "build"), { recursive: true });
            fs.writeFileSync(path.join(directory, "CMakePresets.json"), JSON.stringify({ version: 6, configurePresets: [{ name: "otherboard" }] }));
            fs.writeFileSync(path.join(directory, "CMakeLists.txt"), "project(demo_app)\n");
            fs.writeFileSync(path.join(directory, "build", "demo_app.elf"), "");
            noos.settings({ "project-path": directory, "build-command": command, "deploy-command": command });
        },
    };
    return harness;
}

const sensor = (fixture: NoosHarness): Promise<void> => fixture.sensor();
const initialised = async (fixture: NoosHarness): Promise<void> => { await fixture.run(["init"]); };
const exported = async (fixture: NoosHarness): Promise<void> => {
    await fixture.sensor();
    const workfile = path.join(fixture.noos.project, "workfile.json");
    fs.copyFileSync(workfile, path.join(fixture.noos.base, "elsewhere.json"));
    fs.rmSync(workfile);
};

const NOOS_CASES: readonly Case<NoosHarness>[] = [
    { route: "init", argv: ["init"], shape: "answer" },
    { route: "init", argv: ["init"], shape: "refusal", prepare: initialised },
    { route: "init", argv: ["init"], shape: "refusal", prepare: fixture => { fixture.noos.settings({ board: undefined }); } },

    { route: "import", argv: ["import", "../elsewhere.json"], shape: "answer", prepare: exported },
    { route: "import", argv: ["import", "../elsewhere.json"], shape: "refusal", prepare: async fixture => { await exported(fixture); await fixture.run(["init"]); } },
    { route: "import", argv: ["import", "missing.json"], shape: "refusal" },

    { route: "add", argv: ["add", "eval-testpart"], shape: "answer", prepare: initialised },
    { route: "add", argv: ["add", "test_gpio_pin"], shape: "answer", prepare: initialised },
    { route: "add", argv: ["add", "nonesuch"], shape: "refusal", prepare: initialised },
    { route: "add", argv: ["add", "eval-testpart"], shape: "refusal" },

    { route: "read", argv: ["read"], shape: "answer", prepare: sensor },
    { route: "read", argv: ["read", "testpart_spi_dev"], shape: "answer", prepare: sensor },
    { route: "read", argv: ["read", "testpart_spi_dev", "mode"], shape: "answer", prepare: sensor },
    { route: "read", argv: ["read", "testpart_spi_dev", "max_speed_hz"], shape: "answer", prepare: sensor },
    { route: "read", argv: ["read", "no_such_node"], shape: "refusal", prepare: sensor },
    { route: "read", argv: ["read"], shape: "refusal" },

    { route: "update", argv: ["update", "testpart_spi_dev", "max_speed_hz", "2000000"], shape: "answer", prepare: sensor },
    { route: "update", argv: ["update", "testpart_spi_dev", "mode"], shape: "answer", prepare: sensor },
    { route: "update", argv: ["update", "testpart_spi_dev", "mode", "--suggest"], shape: "answer", prepare: sensor },
    { route: "update", argv: ["update", "testpart_spi_dev", "nonsense", "1"], shape: "refusal", prepare: sensor },

    { route: "delete", argv: ["delete", "testpart_cs_gpio"], shape: "answer", prepare: sensor },
    { route: "delete", argv: ["delete", "testpart_cs_gpio", "--force"], shape: "answer", prepare: sensor },
    { route: "delete", argv: ["delete", "testpart_spi_dev", "max_speed_hz"], shape: "answer", prepare: sensor },
    { route: "delete", argv: ["delete", "no_such_node"], shape: "refusal", prepare: sensor },

    { route: "rename", argv: ["rename", "testpart_cs_gpio", "cs_pin"], shape: "answer", prepare: sensor },
    { route: "rename", argv: ["rename", "no_such_node", "x"], shape: "refusal", prepare: sensor },

    { route: "list devices", argv: ["list", "devices"], shape: "answer", prepare: initialised },
    { route: "list devices", argv: ["list", "devices", "eval-"], shape: "answer", prepare: initialised },
    { route: "list devices", argv: ["list", "devices"], shape: "refusal" },

    { route: "list context", argv: ["list", "context"], shape: "answer" },
    { route: "list context", argv: ["list", "context"], shape: "refusal", prepare: fixture => { fixture.noos.settings({ "capi-path": undefined, "module-paths": undefined }); } },

    { route: "list property", argv: ["list", "property"], shape: "answer", prepare: sensor },
    { route: "list property", argv: ["list", "property", "testpart_spi_dev"], shape: "answer", prepare: sensor },
    { route: "list property", argv: ["list", "property", "no_such_node"], shape: "refusal", prepare: sensor },

    { route: "list value", argv: ["list", "value", "testpart_spi_dev", "mode"], shape: "answer", prepare: sensor },
    { route: "list value", argv: ["list", "value", "testpart_spi_dev", "nonsense"], shape: "refusal", prepare: sensor },

    { route: "validate", argv: ["validate"], shape: "answer", prepare: sensor },
    { route: "validate", argv: ["validate"], shape: "refusal" },

    { route: "build", argv: ["build"], shape: "answer", prepare: fixture => fixture.project("true") },
    { route: "build", argv: ["build"], shape: "refusal", prepare: fixture => fixture.project("false") },
    { route: "build", argv: ["build"], shape: "refusal", prepare: sensor },

    { route: "deploy", argv: ["deploy"], shape: "answer", prepare: fixture => fixture.project("true") },
    { route: "deploy", argv: ["deploy"], shape: "refusal", prepare: fixture => fixture.project("false") },

    { route: "generate", argv: ["generate", "--output", "generated"], shape: "answer", prepare: sensor },
    { route: "generate", argv: ["generate"], shape: "refusal" },

    { route: "config", argv: ["config"], shape: "answer" },
    { route: "config", argv: ["config", "board"], shape: "answer" },
    { route: "config", argv: ["config", "board", "otherboard"], shape: "answer" },
    { route: "config", argv: ["config", "interview", "--reset"], shape: "answer" },
    { route: "config", argv: ["config"], shape: "config-error", prepare: broken_settings },
    { route: "completion", argv: ["completion", "bash"], shape: "answer" },
    { route: "skill install", argv: ["skill", "install", "analog-attach-noos"], shape: "refusal" },
    { route: "skill uninstall", argv: ["skill", "uninstall", "analog-attach-noos"], shape: "refusal" },
];

check_contract<NoosHarness>({
    id: "noos",
    create: create_noos_harness,
    cases: NOOS_CASES,
    sample: { path: "testpart_spi_dev", property: "max_speed_hz", values: "1", device: "eval-testpart", filter: "eval", name: "x", member: "x" },
    prepare_completion: sensor,
});

test("every backend of the registry has its contract here", () => {
    expect(CHECKED.toSorted()).toEqual(Object.keys(BACKENDS).toSorted());
});
