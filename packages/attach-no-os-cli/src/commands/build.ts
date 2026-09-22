import fs from "node:fs";
import { buildCommand } from "@stricli/core";
import { find_board, get_effective_setting_value, get_setting_value } from "attach-no-os-lib";
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
 * Which project is a setting, not an argument: `project_path`, or where `generate` would have
 * written it. See `get_project_path`.
 */
// definition because otherwise it clashes with the stricli function
export const buildCommandDefinition = buildCommand<BuildFlags, []>({
    docs: {
        brief: "Build a no-OS project",
        fullDescription:
            "Builds the project named by the 'project_path' setting, or the one 'generate' would\n" +
            "have written ('<output_path>/<project_name>'), or the current directory."
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
        // is not a generated no-OS project or a build CMake cannot express.
        const override = get_effective_setting_value("build_command");
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

        const noos_path = get_setting_value("no_os_path");
        if (!noos_path.ok) {
            output_error(flags, "no_os_path is not configured. Run: attach-noos tool-config-set no_os_path <path>");
            return;
        }

        const checks = preflight(noos_path.value);
        if (!checks.ok) {
            output_error(flags, checks.error.message);
            return;
        }

        const plan = plan_build(target_path, noos_path.value, flags.board);
        if (!plan.ok) {
            output_error(flags, plan.error.message);
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
            output_error(flags, message, hint === undefined ? {} : { text: `${message}\n\n${hint}` });
            return;
        }

        const compile = await run("cmake", build_arguments(plan.value, plan.value.project_name), plan.value.source_directory);
        if (compile.exit_code !== 0) {
            output_error(flags, `Build failed with exit code ${compile.exit_code}`);
            return;
        }

        const elf_exists = fs.existsSync(plan.value.elf_path);
        const text = elf_exists
            ? `Build completed successfully\n\n  ${plan.value.elf_path}`
            : `Build reported success but no ELF was found at ${plan.value.elf_path}`;

        const message = elf_exists
            ? `Built ${plan.value.project_name} for ${plan.value.board} (${plan.value.mode}): ${plan.value.elf_path}`
            : `Built ${plan.value.project_name} for ${plan.value.board} (${plan.value.mode}), but no ELF was found at ${plan.value.elf_path}`;

        output(flags, text, common_ok(message, elf_exists ? "info" : "warn"));
    }
});
