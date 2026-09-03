import { buildCommand } from "@stricli/core";
import path from "node:path";
import fs from "node:fs";
import { get_setting_value } from "attach-no-os-lib";
import {
    build_arguments,
    configure_arguments,
    plan_build,
    preflight,
    run,
    run_shell,
} from "../build/cmake_build";
import { filter_completions, get_board_names } from "../completion/completion";
import { output, output_error } from "./shared";

// Probes no-OS knows how to flash with (cmake/FlashTools.cmake). Without PROBE set,
// the configure step emits a warning and creates no `flash` target at all.
const PROBES = ["openocd", "jlink"];
const DEFAULT_PROBE = "openocd";

// no-OS names the flash target `flash`, not after the project.
const FLASH_TARGET = "flash";

export const deployCommand = buildCommand<
    { json?: boolean; board?: string; probe?: string },
    [string | undefined]
>({
    docs: { brief: "Deploy a no-OS project" },
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
                brief: "Deploy to this board instead of the one the project was generated for",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_board_names(), partial);
                }
            },
            probe: {
                kind: "parsed",
                brief: `Debug probe used to flash: ${PROBES.join(" or ")} (default: ${DEFAULT_PROBE})`,
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(PROBES, partial);
                }
            },
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

        // An explicit deploy_command takes the step over completely.
        const override = get_setting_value("deploy_command");
        if (override.ok) {
            if (!flags.json) {
                console.log(`Deploying project in ${target_path}`);
                console.log(`Running: ${override.value}\n`);
            }

            const result = await run_shell(override.value, target_path);
            if (result.exit_code !== 0) {
                output_error(flags, "deploy_failed", `Deploy failed with exit code ${result.exit_code}`);
                return;
            }

            output(flags, "Deploy completed successfully", {
                project_path: target_path,
                command: override.value,
                exit_code: result.exit_code
            });
            return;
        }

        const probe = flags.probe ?? DEFAULT_PROBE;
        if (!PROBES.includes(probe)) {
            output_error(flags, "unknown_probe", `Unknown probe '${probe}'. Supported: ${PROBES.join(", ")}`);
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

        if (!flags.json) {
            console.log(`Flashing ${plan.value.project_name} to ${plan.value.board} via ${probe} (${plan.value.mode})`);
            for (const note of checks.value) {
                console.log(`  ${note}`);
            }
            console.log();
        }

        // PROBE is a configure-time cache variable: the `flash` target only exists if
        // it was set when the build directory was configured, so configure runs here
        // even if the project was already built.
        const configure = await run(
            "cmake",
            configure_arguments(plan.value, [`-DPROBE=${probe}`]),
            plan.value.source_directory,
        );
        if (configure.exit_code !== 0) {
            output_error(flags, "configure_failed", `CMake configure failed with exit code ${configure.exit_code}`);
            return;
        }

        const flash = await run(
            "cmake",
            build_arguments(plan.value, FLASH_TARGET),
            plan.value.source_directory,
        );
        if (flash.exit_code !== 0) {
            output_error(flags, "deploy_failed", `Deploy failed with exit code ${flash.exit_code}`);
            return;
        }

        output(flags, "Deploy completed successfully", {
            project_path: target_path,
            project_name: plan.value.project_name,
            board: plan.value.board,
            mode: plan.value.mode,
            probe: probe,
            exit_code: flash.exit_code
        });
    }
});
