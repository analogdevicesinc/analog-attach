// A no-OS project for the backend's tests through the front end's `main`, pointed at
// attach-no-os-lib's fixtures: a capi checkout, a platform with a jumper-wired board
// (otherboard) and one with two SPI buses (twobusboard), and a driver collection with a
// test part and its eval board. Home and the global settings are temp directories too.

import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { main } from "../../../front/main";
import { capture_stream } from "../../../front/output";
import type { Registry } from "../../../front/registry";
import { PromptCancelled, type Choice, type Prompter } from "../../../interface/backend-interface";

export const FIXTURES = path.resolve(import.meta.dirname, "../../../../../attach-no-os-lib/test/fixtures");
export const NOOS_REGISTRY: Registry = { noos: () => import("../index").then(module => module.backend) };

export interface RunResult { code: number; stdout: string; stderr: string }

export interface RunOptions {
    /** A run on a terminal, asking through this prompter. */
    prompter?: Prompter;
    /** `skill install`'s check for Claude Code. Default: not installed. */
    claude_installed?: boolean;
    /** Default: the no-OS backend alone. */
    registry?: Registry;
}

export type Symbols = Record<string, Record<string, unknown>>;

export interface NoosFixture {
    /** The temp directory everything is in. */
    readonly base: string;
    /** The cwd of a run, where `workfile.json` goes. */
    readonly project: string;
    readonly home: string;
    /** `.analog-attach/config.json`: `backend: noos`, and in its `noos` section the fixtures' capi and modules, otherboard, no interview; `values` on top (undefined drops a key). */
    settings(values?: Record<string, unknown>): void;
    /** The local settings file's `noos` section. */
    config(): Record<string, unknown>;
    /** The workfile's symbols. */
    stored(): Symbols;
    /** One run of `main` in the project. */
    run(argv: readonly string[], options?: RunOptions): Promise<RunResult>;
    /** A `--json` run that must exit 0: its response. */
    json(argv: readonly string[]): Promise<unknown>;
    /** What a run printed on stdout. */
    text(argv: readonly string[]): Promise<string>;
    /** How a run exited. */
    code(argv: readonly string[]): Promise<number>;
    /** A workfile with the test part on its eval board, which wires it. */
    sensor(): Promise<void>;
    remove(): void;
}

export function create_noos_fixture(): NoosFixture {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aa-noos-")));
    const project = path.join(base, "project");
    const home = path.join(base, "home");
    const package_root = path.join(base, "package");
    fs.mkdirSync(project);
    fs.mkdirSync(home);
    fs.mkdirSync(package_root);
    fs.writeFileSync(path.join(package_root, "package.json"), JSON.stringify({ version: "0.0.0-test" }));

    const settings_file = path.join(project, ".analog-attach", "config.json");

    const fixture: NoosFixture = {
        base, project, home,
        settings(values = {}) {
            fs.mkdirSync(path.dirname(settings_file), { recursive: true });
            fs.writeFileSync(settings_file, JSON.stringify({
                backend: "noos",
                noos: {
                    "capi-path": path.join(FIXTURES, "capi"),
                    "module-paths": [path.join(FIXTURES, "platform"), path.join(FIXTURES, "driver-collection")],
                    "board": "otherboard",
                    "interview": "false",
                    ...values,
                },
            }, undefined, 2));
        },
        config() {
            const file = JSON.parse(fs.readFileSync(settings_file, "utf8")) as { noos?: Record<string, unknown> };
            return file.noos ?? {};
        },
        stored() {
            const file = JSON.parse(fs.readFileSync(path.join(project, "workfile.json"), "utf8")) as { symbols: Symbols };
            return file.symbols;
        },
        async run(argv, options = {}) {
            const tty = options.prompter !== undefined;
            const stdout = capture_stream(false);
            const stderr = capture_stream(false);
            const code = await main(argv, {
                registry: options.registry ?? NOOS_REGISTRY,
                streams: { stdout, stderr },
                location: { cwd: project, home, xdg_config_home: path.join(home, ".config") },
                tty: { stdin: tty, stdout: tty },
                ...(options.prompter === undefined ? {} : { prompter: () => options.prompter! }),
                environment: {},
                claude_installed: () => options.claude_installed ?? false,
                package_root,
            });
            return { code, stdout: stdout.text, stderr: stderr.text };
        },
        async json(argv) {
            const result = await fixture.run(["--json", ...argv]);
            if (result.code !== 0) { throw new Error(`${argv.join(" ")}: exit ${String(result.code)}\n${result.stderr}`); }
            return JSON.parse(result.stdout) as unknown;
        },
        async text(argv) {
            const result = await fixture.run(argv);
            return result.stdout;
        },
        async code(argv) {
            const result = await fixture.run(argv);
            return result.code;
        },
        async sensor() {
            const created = await fixture.run(["init"]);
            // On its eval board, so its pinout wires it: a bare `add testpart` would not be.
            const added = await fixture.run(["add", "eval-testpart"]);
            if (created.code !== 0 || added.code !== 0 || !fs.existsSync(path.join(project, "workfile.json"))) {
                throw new Error(`no workfile: ${created.stdout}${created.stderr} / ${added.stdout}${added.stderr}`);
            }
        },
        remove() {
            fs.rmSync(base, { recursive: true, force: true });
        },
    };
    return fixture;
}

/** A prompter that answers from a script, in order, and records the questions; Ctrl-C once the script runs out. */
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

export interface InterviewAnswers {
    /** The value a pick takes, from the choices' values. Default: the first. */
    select?: (values: string[]) => string;
    /** What is typed, in order; then nothing (skip). Each is checked against the prompt's validate. */
    input?: string[];
}

/** A prompter for the interview: picks and typed values from a script, recording each question and each input's validate. */
export function interviewer(answers: InterviewAnswers = {}): Prompter & { asked: string[]; validators: ((value: string) => true | string)[] } {
    const asked: string[] = [];
    const validators: ((value: string) => true | string)[] = [];
    const inputs = [...answers.input ?? []];
    const pick = answers.select ?? ((values: string[]) => values[0] ?? "");
    const cancel = (message: string): Promise<never> => {
        asked.push(message);
        return Promise.reject(new PromptCancelled());
    };
    return {
        asked,
        validators,
        select<T>(question: { message: string; choices: readonly Choice<T>[] }): Promise<T> {
            asked.push(question.message);
            const values = question.choices.map(choice => String(choice.value));
            const picked = pick(values);
            const choice = question.choices.find(candidate => String(candidate.value) === picked);
            return choice === undefined ? Promise.reject(new Error(`no choice ${picked} in ${values.join(", ")}`)) : Promise.resolve(choice.value);
        },
        input(question) {
            asked.push(question.message);
            if (question.validate !== undefined) { validators.push(question.validate.bind(question)); }
            const value = inputs.shift() ?? "";
            const valid = question.validate?.(value) ?? true;
            return valid === true ? Promise.resolve(value) : Promise.reject(new Error(`${question.message}: ${value}: ${valid}`));
        },
        confirm: question => cancel(question.message),
        checkbox: question => cancel(question.message),
        search: question => cancel(question.message),
    };
}
