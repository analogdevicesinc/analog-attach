import fs from "node:fs";
import { get_effective_setting_value, get_setting_value } from "attach-no-os-lib";
import {
    answer,
    command,
    refuse,
    type BuildArguments,
    type FlagSpecs,
    type Outcome,
    type Session,
} from "../../../interface/backend-interface";
import {
    build_arguments,
    configure_arguments,
    plan_build,
    preflight,
    run,
    run_shell,
} from "../build/cmake_build";
import { common_ok, type BuildResponse } from "../protocol/responses";
import { get_project_path, refuse_error } from "./shared";

const BUILD_FLAGS = {
    clean: { kind: "boolean", brief: "Delete the build directory first, forcing a fresh configure" },
} as const satisfies FlagSpecs;

/**
 * `build`: build the generated project.
 *
 * Which project is a setting, not an argument: `project-path`, or where `generate` would have
 * written it. See `get_project_path`. The tools' output goes to stderr as it comes
 * (`session.progress`), so stdout keeps only the result.
 */
export const build = command<BuildArguments, BuildResponse, typeof BUILD_FLAGS>({
    flags: BUILD_FLAGS,
    docs: {
        brief: "Build the generated CAPI project",
        full:
            "Builds the project 'generate' writes: the 'project-path' setting, or\n" +
            "out/<project-name> when it is unset.\n\nExamples:\n  $ analog-attach build\n  $ analog-attach build --clean\n  $ analog-attach config build-dir build-debug\n  $ analog-attach --json build"
    },
    run(_arguments, flags, session) {
        return run_build(flags.clean === true, session);
    }
});

/** The project directory every step acts on, checked to be one. */
export function project_directory(session: Session): { ok: true; path: string } | { ok: false; outcome: Outcome<never> } {
    const resolved = get_project_path(session);
    if (!resolved.ok) {
        return { ok: false, outcome: refuse_error(resolved.error) };
    }
    const target_path = resolved.value;
    if (!fs.existsSync(target_path)) {
        return { ok: false, outcome: refuse(`Project path does not exist: ${target_path}. Run: ${session.program} generate`, { type: "not-generated" }) };
    }
    if (!fs.statSync(target_path).isDirectory()) {
        return { ok: false, outcome: refuse(`Project path is not a directory: ${target_path}`, { type: "invalid-setting" }) };
    }
    return { ok: true, path: target_path };
}

async function run_build(clean: boolean, session: Session): Promise<Outcome<BuildResponse>> {
    const project = project_directory(session);
    if (!project.ok) {
        return project.outcome;
    }
    const target_path = project.path;

    // An explicit build-command takes the step over completely, for a project that
    // is not a generated CAPI project or a build CMake cannot express.
    const override = get_effective_setting_value("build-command");
    if (!override.ok) {
        return refuse_error(override.error);
    }

    if (override.value !== undefined && override.value !== "") {
        const progress = session.progress(`Building ${target_path} with '${override.value}'`);
        const result = await run_shell(override.value, target_path, { line: text => { progress.line(text); }, signal: session.signal });
        if (result.exit_code !== 0) {
            progress.done();
            return refuse(`Build failed with exit code ${String(result.exit_code)}`, { type: "tool-failed" });
        }
        progress.done();

        // The command is the user's, but a generated project still puts its ELF where the
        // plan says: report it when it is there.
        const capi = get_effective_setting_value("capi-path");
        const planned = capi.ok && capi.value !== undefined ? plan_build(target_path, capi.value, session.program) : undefined;
        const artifact = planned?.ok === true && fs.existsSync(planned.value.elf_path) ? planned.value.elf_path : undefined;

        const message = `Built ${target_path} with '${override.value}'`;
        const response: BuildResponse = { ...common_ok(message), ...(artifact === undefined ? {} : { path: artifact }) };
        return answer(response, artifact === undefined ? "Build completed successfully" : `Build completed successfully\n\n  ${artifact}`);
    }

    const capi_path = get_setting_value("capi-path");
    if (!capi_path.ok) {
        return refuse(`capi-path is not configured. Run: ${session.program} config capi-path <path>`, { type: "missing-setting" });
    }

    const plan = plan_build(target_path, capi_path.value, session.program);
    if (!plan.ok) {
        return refuse_error(plan.error);
    }

    const checks = preflight(plan.value, capi_path.value);
    if (!checks.ok) {
        return refuse_error(checks.error);
    }

    if (clean) {
        fs.rmSync(plan.value.binary_directory, { recursive: true, force: true });
    }

    const progress = session.progress(`Building ${plan.value.target} for ${plan.value.board}`);
    const sink = { line: (text: string) => { progress.line(text); }, signal: session.signal };

    // Configure every time. CMake re-configures in moments when nothing changed, and
    // skipping it would miss an edited project.conf, the file a user is most likely to
    // touch by hand.
    const { project_directory: directory, environment } = plan.value;
    const configure = await run("cmake", configure_arguments(plan.value), directory, sink, environment);
    if (configure.exit_code !== 0) {
        progress.done();
        return refuse(`CMake configure failed with exit code ${String(configure.exit_code)}`, { type: "tool-failed" });
    }

    const compile = await run("cmake", build_arguments(plan.value), directory, sink, environment);
    progress.done();
    if (compile.exit_code !== 0) {
        return refuse(`Build failed with exit code ${String(compile.exit_code)}`, { type: "tool-failed" });
    }

    const elf_exists = fs.existsSync(plan.value.elf_path);
    const text = elf_exists
        ? `Build completed successfully\n\n  ${plan.value.elf_path}`
        : `Build reported success but no ELF was found at ${plan.value.elf_path}`;
    const message = elf_exists
        ? `Built ${plan.value.target} for ${plan.value.board}: ${plan.value.elf_path}`
        : `Built ${plan.value.target} for ${plan.value.board}, but no ELF was found at ${plan.value.elf_path}`;

    const response: BuildResponse = {
        ...(elf_exists ? common_ok(message) : common_ok(message, "warn", "output-missing")),
        ...(elf_exists ? { path: plan.value.elf_path } : {}),
    };
    return answer(response, text);
}
