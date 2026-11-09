import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The tools the Linux backend runs come from the user's system, not from the package: dtc
// from the package manager, and dt-schema (dt-mk-schema, dt-validate and the schemas the
// binding parser reads) from PyPI, pinned. They are looked up on PATH on every run
// (COM-118, COM-119), and a problem names the command that installs the missing piece.

/**
 * The dt-schema release the CLI is tested with, and the only one it takes. attach-lib's tests
 * pin the same (vitest.globalSetup.ts, corpus/overlays/corpus.mjs): keep them in step.
 */
export const DT_SCHEMA_VERSION = "2026.9";
/** The oldest dtc that compiles overlays the way `build` and `validate` run it (`-@`). */
export const DTC_MINIMUM = "1.6.0";

/** A problem with an installed tool: what is wrong, and the command that fixes it. */
export interface ToolProblem {
    kind: "missing" | "invalid";
    message: string;
    hint: string;
    /** The version installed in its place, when it is another one. */
    installed?: string;
}

export type Found<T> = { ok: true; value: T } | { ok: false; problem: ToolProblem };

function executable(file: string): boolean {
    try {
        fs.accessSync(file, fs.constants.X_OK);
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

/** The executable `name` is on PATH as, or undefined. A name with a `/` is taken as a path. */
export function find_executable(name: string, search_path: string = process.env["PATH"] ?? ""): string | undefined {
    if (name.includes("/")) { return executable(name) ? path.resolve(name) : undefined; }
    for (const directory of search_path.split(path.delimiter)) {
        if (directory === "") { continue; }
        const candidate = path.join(directory, name);
        if (executable(candidate)) { return candidate; }
    }
    return undefined;
}

/**
 * The interpreter a script's first line names, or undefined when it names none: `#!<path>`,
 * `#!/usr/bin/env <name>` (looked up on PATH), or the form pip writes for a long path, a
 * `#!/bin/sh` line followed by `'''exec' <path> "$0" "$@"`.
 */
export function script_interpreter(script: string, search_path: string = process.env["PATH"] ?? ""): string | undefined {
    let head: string;
    try {
        const descriptor = fs.openSync(script, "r");
        try {
            const buffer = Buffer.alloc(1024);
            head = buffer.subarray(0, fs.readSync(descriptor, buffer, 0, buffer.length, 0)).toString("utf8");
        } finally {
            fs.closeSync(descriptor);
        }
    } catch {
        return undefined;
    }
    const [first = "", second = ""] = head.split("\n");
    if (!first.startsWith("#!")) { return undefined; }
    const [command = "", ...rest] = first.slice(2).trim().split(/\s+/);
    if (path.basename(command) === "env") {
        const name = rest.find(word => !word.startsWith("-"));
        return name === undefined ? undefined : find_executable(name, search_path);
    }
    if (path.basename(command) === "sh") {
        const exec = /^'''exec' (?:'([^']+)'|"([^"]+)"|(\S+))/.exec(second);
        return exec?.[1] ?? exec?.[2] ?? exec?.[3];
    }
    return command;
}

/** `ID` and `ID_LIKE` of an os-release file, as one list of lower-case words. */
function os_release_ids(text: string): string[] {
    return text.split("\n").flatMap(line => {
        const match = /^(ID|ID_LIKE)=(.*)$/.exec(line.trim());
        return match?.[2] === undefined ? [] : match[2].replaceAll(/["']/g, "").toLowerCase().split(/\s+/);
    });
}

function read_os_release(): string {
    try {
        return fs.readFileSync("/etc/os-release", "utf8");
    } catch {
        return "";
    }
}

/** A tool the package manager installs. */
export type SystemTool = "dtc" | "cpp";

/** Per tool: what it is, and the install command on each system, by os-release ID. */
const SYSTEM_TOOLS: Record<SystemTool, { what: string; darwin: string; linux: [string[], string][] }> = {
    dtc: {
        what: "the devicetree compiler",
        darwin: "brew install dtc",
        linux: [
            [["debian", "ubuntu"], "sudo apt install device-tree-compiler"],
            [["fedora", "rhel", "centos"], "sudo dnf install dtc"],
            [["arch"], "sudo pacman -S dtc"],
            [["suse", "opensuse"], "sudo zypper install dtc"],
        ],
    },
    cpp: {
        what: "the C preprocessor",
        darwin: "xcode-select --install",
        linux: [
            [["debian", "ubuntu"], "sudo apt install cpp"],
            [["fedora", "rhel", "centos"], "sudo dnf install cpp"],
            [["arch"], "sudo pacman -S gcc"],
            [["suse", "opensuse"], "sudo zypper install cpp"],
        ],
    },
};

/** The command that installs `tool` on this system, or undefined when the system isn't one we know. */
export function install_command(tool: SystemTool, platform: NodeJS.Platform = os.platform(), os_release: () => string = read_os_release): string | undefined {
    const { darwin, linux } = SYSTEM_TOOLS[tool];
    if (platform === "darwin") { return darwin; }
    if (platform !== "linux") { return undefined; }
    const ids = os_release_ids(os_release());
    return linux.find(([names]) => names.some(name => ids.includes(name)))?.[1];
}

/** The hint of a problem with `tool`: the platform's install command. `what` names what to install (`dtc 1.6.0 or later`). */
export function install_hint(tool: SystemTool, what: string = tool): string {
    const command = install_command(tool);
    return command === undefined ? `Install ${what}, ${SYSTEM_TOOLS[tool].what}, with your package manager.` : `Install ${what}: '${command}'.`;
}

/** The first `x.y.z` of a `--version` output. */
const version_of = (output: string): string | undefined => /(\d+\.\d+\.\d+)/.exec(output)?.[1];

/** What `<tool> --version` prints, or undefined when it can't run or exits non-zero. */
function version_output(tool: string): string | undefined {
    try {
        return execFileSync(tool, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
    } catch {
        return undefined;
    }
}

/** The pipx commands that install the pinned dt-schema; `force` replaces another version. */
export function dt_schema_commands(force = false): string[] {
    return [`pipx install ${force ? "--force " : ""}dtschema==${DT_SCHEMA_VERSION}`, "pipx inject dtschema ruamel.yaml.clib"];
}

/** The hint of a dt-schema problem; `force` when another version is installed. */
export function dt_schema_hint(force = false, not_on_path = false): string {
    const [install, inject] = dt_schema_commands(force);
    const where = not_on_path ? " (and 'pipx ensurepath' when pipx's bin directory isn't on PATH)" : "";
    return `Install dt-schema ${DT_SCHEMA_VERSION}${force ? " in its place" : ""}: '${install}', then '${inject}'${where}.`;
}

const version_parts = (text: string): number[] => text.split(".").map(Number);

/** `a.b.c` against `x.y.z`: negative when older. */
function compare_versions(version: string, other: string): number {
    const [left, right] = [version_parts(version), version_parts(other)];
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) { return difference; }
    }
    return 0;
}

export interface Dtc {
    path: string;
    /** As `dtc --version` gives it, or undefined when it gives none we can read. */
    version?: string;
}

/** dtc on PATH, at least DTC_MINIMUM (COM-118). A version it doesn't print readably is taken. */
export function find_dtc(program: string): Found<Dtc> {
    const dtc = find_executable("dtc");
    if (dtc === undefined) { return { ok: false, problem: { kind: "missing", message: "dtc not found on PATH", hint: install_hint("dtc") } }; }
    // A dtc that can't say its version is still tried.
    const version = version_of(version_output(dtc) ?? "");
    if (version !== undefined && compare_versions(version, DTC_MINIMUM) < 0) {
        return { ok: false, problem: { kind: "invalid", message: `dtc ${version} is too old; ${program} needs ${DTC_MINIMUM} or later`, hint: install_hint("dtc", `dtc ${DTC_MINIMUM} or later`) } };
    }
    return { ok: true, value: { path: dtc, ...(version === undefined ? {} : { version }) } };
}

/** The tool a `preprocess-command` runs: its first word. */
export const preprocess_tool = (command: string): string => command.trim().split(/\s+/)[0] ?? "";

/**
 * The preprocessor of `preprocess-command` (COM-093): found when `<tool> --version` runs.
 * The hint says how to install it when it is cpp; another tool is the user's own.
 */
export function find_preprocessor(command: string): Found<{ tool: string; version?: string }> {
    const tool = preprocess_tool(command);
    const output = version_output(tool);
    if (output === undefined) {
        const hint = path.basename(tool) === "cpp" ? install_hint("cpp") : `Install ${tool}, or set preprocess-command to another command.`;
        return { ok: false, problem: { kind: "missing", message: `${tool} not found on PATH`, hint } };
    }
    const version = version_of(output);
    return { ok: true, value: { tool, ...(version === undefined ? {} : { version }) } };
}

/** The installed dt-schema: where the parser finds its schemas, and what runs its tools. */
export interface DtSchemaInstall {
    /** The directory holding the `dtschema` package (`<root>/dtschema/schemas`). */
    root: string;
    version: string;
    /** The Python that runs `dt-mk-schema`. */
    python: string;
    dt_mk_schema: string;
}

/** Asks a Python where its `dtschema` package is and which version, without importing it. */
const PROBE = [
    "import importlib.metadata as m, importlib.util as u, json, os",
    "s = u.find_spec('dtschema')",
    "locations = [] if s is None or s.submodule_search_locations is None else list(s.submodule_search_locations)",
    "print(json.dumps({'root': os.path.dirname(locations[0]), 'version': m.version('dtschema')} if locations else None))",
].join("\n");

/** What PROBE prints with `python`, or undefined when it can't run it or has no dtschema package. */
function probe(python: string): { root: string; version: string } | undefined {
    try {
        const output = execFileSync(python, ["-c", PROBE], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
        return (JSON.parse(output) as { root: string; version: string } | null) ?? undefined;
    } catch {
        return undefined;
    }
}

const is_python = (interpreter: string): boolean => /^python[\d.]*$/.test(path.basename(interpreter));

/**
 * The dt-schema that `dt-mk-schema` on PATH comes with (COM-119): the Python its first line
 * names says where its `dtschema` package is, and which version. Only DT_SCHEMA_VERSION is taken.
 */
export function find_dt_schema(program: string): Found<DtSchemaInstall> {
    const fail = (kind: ToolProblem["kind"], message: string, hint = dt_schema_hint()): Found<never> => ({ ok: false, problem: { kind, message, hint } });
    const dt_mk_schema = find_executable("dt-mk-schema");
    if (dt_mk_schema === undefined) { return fail("missing", "dt-mk-schema not found on PATH", dt_schema_hint(false, true)); }
    const python = script_interpreter(dt_mk_schema);
    if (python === undefined || !is_python(python)) { return fail("invalid", `Can't tell which Python runs ${dt_mk_schema}`); }
    const found = probe(python);
    if (found === undefined) { return fail("missing", `${python} (which runs ${dt_mk_schema}) can't load the dtschema package`); }
    if (found.version !== DT_SCHEMA_VERSION) {
        const problem = fail("invalid", `dt-schema ${found.version} is installed (${found.root}); ${program} needs ${DT_SCHEMA_VERSION}`, dt_schema_hint(true));
        return problem.ok ? problem : { ok: false, problem: { ...problem.problem, installed: found.version } };
    }
    return { ok: true, value: { root: found.root, version: found.version, python, dt_mk_schema } };
}

/** dt-validate on PATH (COM-119). */
export function find_dt_validate(): Found<string> {
    const dt_validate = find_executable("dt-validate");
    return dt_validate === undefined
        ? { ok: false, problem: { kind: "missing", message: "dt-validate not found on PATH", hint: dt_schema_hint(false, true) } }
        : { ok: true, value: dt_validate };
}

/** What the setup run says of the tools (SETUP-100): each one found, or its problem. */
export interface ToolsReport {
    /** `dtc`, the preprocessor and `dt-schema`, each with its version (the path, or the tool, when it prints none). */
    found: { name: string; value: string }[];
    problems: { name: string; problem: ToolProblem }[];
    /** The pipx commands that install dt-schema, when it has a problem (SETUP-102). */
    dt_schema_install?: string[];
}

/** dtc, the preprocessor of `preprocess_command`, dt-schema and dt-validate, looked up as a command looks them up. */
export function check_tools(program: string, preprocess_command: string): ToolsReport {
    const report: ToolsReport = { found: [], problems: [] };
    const dtc = find_dtc(program);
    if (dtc.ok) { report.found.push({ name: "dtc", value: dtc.value.version ?? dtc.value.path }); } else { report.problems.push({ name: "dtc", problem: dtc.problem }); }
    const preprocessor = find_preprocessor(preprocess_command);
    const name = path.basename(preprocess_tool(preprocess_command));
    if (preprocessor.ok) { report.found.push({ name, value: preprocessor.value.version ?? preprocessor.value.tool }); } else { report.problems.push({ name, problem: preprocessor.problem }); }
    const dt_schema = find_dt_schema(program);
    const dt_validate = find_dt_validate();
    if (!dt_schema.ok) {
        report.problems.push({ name: "dt-schema", problem: dt_schema.problem });
        report.dt_schema_install = dt_schema_commands(dt_schema.problem.installed !== undefined);
    } else if (dt_validate.ok) {
        report.found.push({ name: "dt-schema", value: dt_schema.value.version });
    } else {
        // An installation without its dt-validate: installed again.
        report.problems.push({ name: "dt-validate", problem: dt_validate.problem });
        report.dt_schema_install = dt_schema_commands(true);
    }
    return report;
}

/** Our parallel dt-mk-schema (`scripts/dt-mk-schema.py`), which the build copies into the backend's assets. */
export const MK_SCHEMA_SCRIPT = "dt-mk-schema.py";

/**
 * How to run dt-mk-schema: the installation's Python on our parallel script when the package
 * has it, else the installed `dt-mk-schema`, slower, with the same output.
 */
export function mk_schema_command(install: DtSchemaInstall, assets_directory: string): readonly string[] {
    const script = path.join(assets_directory, MK_SCHEMA_SCRIPT);
    return fs.existsSync(script) ? [install.python, script] : [install.dt_mk_schema];
}

if (import.meta.vitest) {
    const { test, expect, beforeAll, afterAll } = import.meta.vitest;

    let root: string;
    beforeAll(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "attach-tools-"))); });
    afterAll(() => { fs.rmSync(root, { recursive: true }); });

    const script = (name: string, text: string): string => {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text, { mode: 0o755 });
        return file;
    };

    test("find_executable - the first match on PATH, executable files only", () => {
        const first = script(path.join("a", "tool"), "#!/bin/sh\n");
        script(path.join("b", "tool"), "#!/bin/sh\n");
        fs.writeFileSync(path.join(root, "a", "plain"), "");
        const search = [path.join(root, "missing"), path.join(root, "a"), path.join(root, "b")].join(path.delimiter);
        expect(find_executable("tool", search)).toBe(first);
        expect(find_executable("plain", search)).toBeUndefined();
        expect(find_executable(first, "")).toBe(first);
    });

    test("script_interpreter - a path, env and a name on PATH, pip's long-path form, none", () => {
        const python = script(path.join("bin", "python3"), "#!/bin/sh\n");
        expect(script_interpreter(script("direct", "#!/venv/bin/python\nimport sys\n"))).toBe("/venv/bin/python");
        expect(script_interpreter(script("env", "#!/usr/bin/env -S python3\n"), path.join(root, "bin"))).toBe(python);
        expect(script_interpreter(script("long", "#!/bin/sh\n'''exec' '/very long/bin/python' \"$0\" \"$@\"\n' '''\n"))).toBe("/very long/bin/python");
        expect(script_interpreter(script("binary", "\u007FELF"))).toBeUndefined();
        expect(script_interpreter(path.join(root, "nope"))).toBeUndefined();
    });

    test("install_command - by os-release ID and ID_LIKE, brew or Xcode on macOS, none elsewhere", () => {
        expect(install_command("dtc", "linux", () => 'ID=ubuntu\nID_LIKE=debian\n')).toBe("sudo apt install device-tree-compiler");
        expect(install_command("dtc", "linux", () => 'ID="rocky"\nID_LIKE="rhel centos fedora"\n')).toBe("sudo dnf install dtc");
        expect(install_command("dtc", "linux", () => "ID=arch\n")).toBe("sudo pacman -S dtc");
        expect(install_command("dtc", "linux", () => 'ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\n')).toBe("sudo zypper install dtc");
        expect(install_command("dtc", "linux", () => "ID=nixos\n")).toBeUndefined();
        expect(install_command("dtc", "darwin")).toBe("brew install dtc");
        expect(install_command("dtc", "win32")).toBeUndefined();
        expect(install_command("cpp", "linux", () => 'ID=ubuntu\nID_LIKE=debian\n')).toBe("sudo apt install cpp");
        expect(install_command("cpp", "linux", () => "ID=fedora\n")).toBe("sudo dnf install cpp");
        expect(install_command("cpp", "linux", () => "ID=arch\n")).toBe("sudo pacman -S gcc");
        expect(install_command("cpp", "linux", () => "ID=opensuse-leap\nID_LIKE=\"suse opensuse\"\n")).toBe("sudo zypper install cpp");
        expect(install_command("cpp", "darwin")).toBe("xcode-select --install");
    });

    test("dt_schema_hint - the pinned pipx commands, --force over another version", () => {
        expect(dt_schema_hint()).toBe(`Install dt-schema ${DT_SCHEMA_VERSION}: 'pipx install dtschema==${DT_SCHEMA_VERSION}', then 'pipx inject dtschema ruamel.yaml.clib'.`);
        expect(dt_schema_hint(true)).toBe(`Install dt-schema ${DT_SCHEMA_VERSION} in its place: 'pipx install --force dtschema==${DT_SCHEMA_VERSION}', then 'pipx inject dtschema ruamel.yaml.clib'.`);
        expect(dt_schema_hint(false, true)).toContain("'pipx ensurepath' when pipx's bin directory isn't on PATH");
    });

    test("compare_versions - by number, part by part", () => {
        expect(compare_versions("1.5.1", "1.6.0")).toBeLessThan(0);
        expect(compare_versions("1.10.0", "1.6.0")).toBeGreaterThan(0);
        expect(compare_versions("1.6.0", "1.6.0")).toBe(0);
    });

    /** PATH set to `directory` while `body` runs. */
    const with_path = <T>(directory: string, body: () => T): T => {
        const original = process.env["PATH"];
        process.env["PATH"] = directory;
        try {
            return body();
        } finally {
            process.env["PATH"] = original;
        }
    };

    test("find_dtc - missing, too old, new enough, and a version it can't read", () => {
        const bin = path.join(root, "dtc-bin");
        expect(with_path(bin, () => find_dtc("aa"))).toMatchObject({ ok: false, problem: { kind: "missing", message: "dtc not found on PATH" } });
        script(path.join("dtc-bin", "dtc"), "#!/bin/sh\necho 'Version: DTC 1.5.1'\n");
        expect(with_path(bin, () => find_dtc("aa"))).toMatchObject({ ok: false, problem: { kind: "invalid", message: "dtc 1.5.1 is too old; aa needs 1.6.0 or later" } });
        script(path.join("dtc-bin", "dtc"), "#!/bin/sh\necho 'Version: DTC v1.8.1'\n");
        expect(with_path(bin, () => find_dtc("aa"))).toEqual({ ok: true, value: { path: path.join(bin, "dtc"), version: "1.8.1" } });
        script(path.join("dtc-bin", "dtc"), "#!/bin/sh\nexit 1\n");
        expect(with_path(bin, () => find_dtc("aa"))).toEqual({ ok: true, value: { path: path.join(bin, "dtc") } });
    });

    /** A fake dt-schema install: dt-mk-schema run by a `python` that answers the probe with `answer`. */
    const install = (name: string, answer: string, interpreter = "python"): string => {
        const bin = path.join(root, name, "bin");
        const python = script(path.join(name, "bin", interpreter), `#!/bin/sh\necho '${answer}'\n`);
        script(path.join(name, "bin", "dt-mk-schema"), `#!${python}\n`);
        return bin;
    };

    test("find_dt_schema - found through dt-mk-schema's Python, only at the pinned version", () => {
        const pinned = install("pinned", JSON.stringify({ root: "/site", version: DT_SCHEMA_VERSION }));
        expect(with_path(pinned, () => find_dt_schema("aa"))).toEqual({
            ok: true,
            value: { root: "/site", version: DT_SCHEMA_VERSION, python: path.join(pinned, "python"), dt_mk_schema: path.join(pinned, "dt-mk-schema") },
        });
        const other = install("other", JSON.stringify({ root: "/site", version: "2026.10" }));
        expect(with_path(other, () => find_dt_schema("aa"))).toEqual({
            ok: false,
            problem: { kind: "invalid", message: `dt-schema 2026.10 is installed (/site); aa needs ${DT_SCHEMA_VERSION}`, hint: dt_schema_hint(true), installed: "2026.10" },
        });
    });

    test("find_dt_schema - not on PATH, run by something other than Python, a Python without the package", () => {
        expect(with_path(path.join(root, "nothing"), () => find_dt_schema("aa"))).toMatchObject({ ok: false, problem: { kind: "missing", message: "dt-mk-schema not found on PATH" } });
        const shell = install("shell", "null", "bash");
        expect(with_path(shell, () => find_dt_schema("aa"))).toMatchObject({ ok: false, problem: { kind: "invalid", message: `Can't tell which Python runs ${path.join(shell, "dt-mk-schema")}` } });
        const empty = install("empty", "null");
        expect(with_path(empty, () => find_dt_schema("aa"))).toMatchObject({ ok: false, problem: { kind: "missing", message: `${path.join(empty, "python")} (which runs ${path.join(empty, "dt-mk-schema")}) can't load the dtschema package` } });
    });

    test("find_preprocessor - the command's first word, with its version; an install hint for cpp only", () => {
        const bin = path.join(root, "cpp-bin");
        expect(with_path(bin, () => find_preprocessor("cpp -P -o {output} {input}"))).toEqual({ ok: false, problem: { kind: "missing", message: "cpp not found on PATH", hint: install_hint("cpp") } });
        expect(with_path(bin, () => find_preprocessor("mypp {input}"))).toEqual({
            ok: false, problem: { kind: "missing", message: "mypp not found on PATH", hint: "Install mypp, or set preprocess-command to another command." },
        });
        script(path.join("cpp-bin", "cpp"), "#!/bin/sh\necho 'cpp (GCC) 16.2.1 20260810'\n");
        expect(with_path(bin, () => find_preprocessor("cpp -P"))).toEqual({ ok: true, value: { tool: "cpp", version: "16.2.1" } });
    });

    test("check_tools - what is found with its version, each problem, and the pipx commands for dt-schema", () => {
        const ready = install("ready", JSON.stringify({ root: "/site", version: DT_SCHEMA_VERSION }));
        script(path.join("ready", "bin", "dtc"), "#!/bin/sh\necho 'Version: DTC 1.7.0'\n");
        script(path.join("ready", "bin", "cpp"), "#!/bin/sh\necho 'cpp (GCC) 13.2.0'\n");
        expect(with_path(ready, () => check_tools("aa", "cpp -P"))).toMatchObject({
            found: [{ name: "dtc", value: "1.7.0" }, { name: "cpp", value: "13.2.0" }], problems: [{ name: "dt-validate" }], dt_schema_install: dt_schema_commands(true),
        });
        script(path.join("ready", "bin", "dt-validate"), "#!/bin/sh\n");
        expect(with_path(ready, () => check_tools("aa", "cpp -P"))).toEqual({
            found: [{ name: "dtc", value: "1.7.0" }, { name: "cpp", value: "13.2.0" }, { name: "dt-schema", value: DT_SCHEMA_VERSION }], problems: [],
        });
        const other = install("other-version", JSON.stringify({ root: "/site", version: "2026.10" }));
        const report = with_path(other, () => check_tools("aa", "cpp -P"));
        expect(report.problems.map(problem => problem.name)).toEqual(["dtc", "cpp", "dt-schema"]);
        expect(report.dt_schema_install).toEqual([`pipx install --force dtschema==${DT_SCHEMA_VERSION}`, "pipx inject dtschema ruamel.yaml.clib"]);
        expect(with_path(path.join(root, "nothing"), () => check_tools("aa", "cpp -P")).dt_schema_install).toEqual(dt_schema_commands());
    });

    test("mk_schema_command - the parallel script when the assets have it, else dt-mk-schema", () => {
        const found: DtSchemaInstall = { root: "/site", version: DT_SCHEMA_VERSION, python: "/venv/bin/python", dt_mk_schema: "/venv/bin/dt-mk-schema" };
        const assets = path.join(root, "assets");
        fs.mkdirSync(assets, { recursive: true });
        expect(mk_schema_command(found, assets)).toEqual(["/venv/bin/dt-mk-schema"]);
        fs.writeFileSync(path.join(assets, MK_SCHEMA_SCRIPT), "");
        expect(mk_schema_command(found, assets)).toEqual(["/venv/bin/python", path.join(assets, MK_SCHEMA_SCRIPT)]);
    });
}
