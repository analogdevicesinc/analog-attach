import { buildCommand } from "@stricli/core";
import path from "node:path";
import fs from "node:fs";
import { find_board, get_setting_value } from "attach-no-os-lib";
import {
    build_arguments,
    configure_arguments,
    missing_prerequisite_hint,
    plan_build,
    preflight,
    run,
    run_shell,
} from "../build/cmake_build";
import { filter_completions, get_board_names } from "../completion/completion";
import { output, output_error } from "./shared";

// definition because otherwise it clashes with the stricli function
export const buildCommandDefinition = buildCommand<
    { json?: boolean; board?: string; clean?: boolean },
    [string | undefined]
>({
    docs: { brief: "Build a no-OS project" },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                { placeholder: "project_path", brief: "Path to project (default: current directory)", optional: true, parse: String }
            ]
        },
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
    func: async (flags, project_path) => {
        const target_path = project_path ? path.resolve(project_path) : process.cwd();

        if (!fs.existsSync(target_path)) {
            output_error(flags, "path_not_found", `Project path does not exist: ${target_path}`);
            return;
        }

        if (!fs.statSync(target_path).isDirectory()) {
            output_error(flags, "not_directory", `Project path is not a directory: ${target_path}`);
            return;
        }

        // An explicit build_command takes the step over completely, for a project that
        // is not a generated no-OS project or a build CMake cannot express.
        const override = get_setting_value("build_command");
        if (override.ok) {
            if (!flags.json) {
                console.log(`Building project in ${target_path}`);
                console.log(`Running: ${override.value}\n`);
            }

            const result = await run_shell(override.value, target_path);
            if (result.exit_code !== 0) {
                output_error(flags, "build_failed", `Build failed with exit code ${result.exit_code}`);
                return;
            }

            output(flags, "Build completed successfully", {
                project_path: target_path,
                command: override.value,
                exit_code: result.exit_code
            });
            return;
        }

        const noos_path = get_setting_value("no_os_path");
        if (!noos_path.ok) {
            output_error(flags, "config_missing", "no_os_path is not configured. Run: aa config no_os_path <path>");
            return;
        }

        const checks = preflight(noos_path.value);
        if (!checks.ok) {
            output_error(flags, "preflight_failed", checks.error.message);
            return;
        }

        const plan = plan_build(target_path, noos_path.value, flags.board);
        if (!plan.ok) {
            output_error(flags, "plan_failed", plan.error.message);
            return;
        }

        if (flags.clean) {
            fs.rmSync(plan.value.binary_directory, { recursive: true, force: true });
        }

        if (!flags.json) {
            console.log(`Building ${plan.value.project_name} for ${plan.value.board} (${plan.value.mode})`);
            for (const note of checks.value) {
                console.log(`  ${note}`);
            }
            console.log();
        }

        // Configure every time. CMake re-configures in milliseconds when nothing
        // changed, and skipping it would miss an edited project.conf - which is the
        // one file a user is most likely to touch by hand.
        const configure = await run("cmake", configure_arguments(plan.value), plan.value.source_directory);
        if (configure.exit_code !== 0) {
            // Only maxim boards build from a bare checkout; the other vendors need a
            // file from their own tooling that neither codegen nor Kconfig can supply.
            // Naming it here is the whole reason generation does not refuse those
            // boards up front.
            const board = find_board(noos_path.value, plan.value.board);
            const hint = board.ok ? missing_prerequisite_hint(board.value.vendor) : undefined;
            const message = `CMake configure failed with exit code ${configure.exit_code}`;
            output_error(flags, "configure_failed", hint === undefined ? message : `${message}\n\n${hint}`);
            return;
        }

        const compile = await run("cmake", build_arguments(plan.value, plan.value.project_name), plan.value.source_directory);
        if (compile.exit_code !== 0) {
            output_error(flags, "build_failed", `Build failed with exit code ${compile.exit_code}`);
            return;
        }

        const elf_exists = fs.existsSync(plan.value.elf_path);
        const text = elf_exists
            ? `Build completed successfully\n\n  ${plan.value.elf_path}`
            : `Build reported success but no ELF was found at ${plan.value.elf_path}`;

        output(flags, text, {
            project_path: target_path,
            project_name: plan.value.project_name,
            board: plan.value.board,
            mode: plan.value.mode,
            build_directory: plan.value.binary_directory,
            elf_path: elf_exists ? plan.value.elf_path : undefined,
            exit_code: compile.exit_code
        });
    }
});
