import fs from "node:fs";
import { buildCommand } from "@stricli/core";
import { get_effective_setting_value, get_setting_value } from "attach-no-os-lib";
import {
    build_arguments,
    configure_arguments,
    plan_build,
    preflight,
    run,
    run_shell,
} from "../build/cmake_build";
import { filter_completions, get_board_names } from "../completion/completion";
import { common_ok } from "../protocol/responses";
import { get_project_path, output, output_error } from "./shared";

type BuildFlags = {
    json?: boolean;
    board?: string;
    clean?: boolean;
};

/**
 * `attach-noos build` — build the generated project.
 *
 * Which project is a setting, not an argument: `project-path`, or where `generate` would have
 * written it. See `get_project_path`.
 */
// definition because otherwise it clashes with the stricli function
export const buildCommandDefinition = buildCommand<BuildFlags, []>({
    docs: {
        brief: "Build the generated CAPI project",
        fullDescription:
            "Builds the project 'generate' writes: the 'project-path' setting, or\n" +
            "out/<project-name> when it is unset."
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            board: {
                kind: "parsed",
                brief: "Build for this board instead of the one the project was generated for",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_board_names(), partial);
                }
            },
            clean: { kind: "boolean", brief: "Delete the build directory first, forcing a fresh configure", optional: true },
        }
    },
    func: async (flags: BuildFlags) => {
        const resolved = get_project_path();
        if (!resolved.ok) {
            output_error(flags, resolved.error.message);
            return;
        }

        const target_path = resolved.value;

        if (!fs.existsSync(target_path)) {
            output_error(flags, `Project path does not exist: ${target_path}`);
            return;
        }

        if (!fs.statSync(target_path).isDirectory()) {
            output_error(flags, `Project path is not a directory: ${target_path}`);
            return;
        }

        // An explicit build_command takes the step over completely, for a project that
        // is not a generated CAPI project or a build CMake cannot express.
        const override = get_effective_setting_value("build-command");
        if (!override.ok) {
            output_error(flags, override.error.message);
            return;
        }

        if (override.value) {
            if (!flags.json) {
                console.log(`Building project in ${target_path}`);
                console.log(`Running: ${override.value}\n`);
            }

            const result = await run_shell(override.value, target_path);
            if (result.exit_code !== 0) {
                output_error(flags, `Build failed with exit code ${result.exit_code}`);
                return;
            }

            const message = `Built ${target_path} with '${override.value}'`;
            output(flags, "Build completed successfully", common_ok(message));
            return;
        }

        const capi_path = get_setting_value("capi-path");
        if (!capi_path.ok) {
            output_error(flags, "capi-path is not configured. Run: attach-noos config capi-path <path>");
            return;
        }

        const plan = plan_build(target_path, capi_path.value, flags.board);
        if (!plan.ok) {
            output_error(flags, plan.error.message);
            return;
        }

        const checks = preflight(plan.value, capi_path.value);
        if (!checks.ok) {
            output_error(flags, checks.error.message);
            return;
        }

        if (flags.clean) {
            fs.rmSync(plan.value.binary_directory, { recursive: true, force: true });
        }

        if (!flags.json) {
            console.log(`Building ${plan.value.target} for ${plan.value.board}\n`);
        }

        // Configure every time. CMake re-configures in moments when nothing changed, and
        // skipping it would miss an edited project.conf, the file a user is most likely to
        // touch by hand.
        const { project_directory, environment } = plan.value;
        const configure = await run("cmake", configure_arguments(plan.value), project_directory, environment);
        if (configure.exit_code !== 0) {
            output_error(flags, `CMake configure failed with exit code ${configure.exit_code}`);
            return;
        }

        const compile = await run("cmake", build_arguments(plan.value), project_directory, environment);
        if (compile.exit_code !== 0) {
            output_error(flags, `Build failed with exit code ${compile.exit_code}`);
            return;
        }

        const elf_exists = fs.existsSync(plan.value.elf_path);
        const text = elf_exists
            ? `Build completed successfully\n\n  ${plan.value.elf_path}`
            : `Build reported success but no ELF was found at ${plan.value.elf_path}`;
        const message = elf_exists
            ? `Built ${plan.value.target} for ${plan.value.board}: ${plan.value.elf_path}`
            : `Built ${plan.value.target} for ${plan.value.board}, but no ELF was found at ${plan.value.elf_path}`;

        output(flags, text, common_ok(message, elf_exists ? "info" : "warn"));
    }
});
