import fs from "node:fs";
import { buildCommand } from "@stricli/core";
import { DEFAULT_PROBE, PROBE_OPTIONS, get_effective_setting_value, get_setting_value } from "attach-no-os-lib";
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

// no-OS names the flash target `flash`, not after the project.
const FLASH_TARGET = "flash";

type DeployFlags = {
    json?: boolean;
    board?: string;
    probe?: string;
};

/**
 * `attach-noos deploy` — flash the built project.
 *
 * Same as `build`: the project comes from settings, and so does the probe, since attach-meta
 * passes no arguments.
 */
export const deployCommand = buildCommand<DeployFlags, []>({
    docs: {
        brief: "Deploy a no-OS project",
        fullDescription:
            "Flashes the project named by the 'project_path' setting, or the one 'generate' would\n" +
            "have written ('<output_path>/<project_name>'), or the current directory."
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
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
                brief: `Debug probe used to flash: ${PROBE_OPTIONS.join(" or ")} (default: the 'probe' setting)`,
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(PROBE_OPTIONS, partial);
                }
            },
        }
    },
    func: async (flags: DeployFlags) => {
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

        // An explicit deploy_command takes the step over completely.
        const override = get_effective_setting_value("deploy_command");
        if (!override.ok) {
            output_error(flags, override.error.message);
            return;
        }

        if (override.value) {
            if (!flags.json) {
                console.log(`Deploying project in ${target_path}`);
                console.log(`Running: ${override.value}\n`);
            }

            const result = await run_shell(override.value, target_path);
            if (result.exit_code !== 0) {
                output_error(flags, `Deploy failed with exit code ${result.exit_code}`);
                return;
            }

            const message = `Deployed ${target_path} with '${override.value}'`;
            output(flags, "Deploy completed successfully", common_ok(message));
            return;
        }

        const configured_probe = get_effective_setting_value("probe");
        if (!configured_probe.ok) {
            output_error(flags, configured_probe.error.message);
            return;
        }

        const probe = flags.probe ?? configured_probe.value ?? DEFAULT_PROBE;
        if (!PROBE_OPTIONS.includes(probe)) {
            output_error(flags, `Unknown probe '${probe}'. Supported: ${PROBE_OPTIONS.join(", ")}`);
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
            output_error(flags, `CMake configure failed with exit code ${configure.exit_code}`);
            return;
        }

        const flash = await run(
            "cmake",
            build_arguments(plan.value, FLASH_TARGET),
            plan.value.source_directory,
        );
        if (flash.exit_code !== 0) {
            output_error(flags, `Deploy failed with exit code ${flash.exit_code}`);
            return;
        }

        const message = `Flashed ${plan.value.project_name} to ${plan.value.board} via ${probe} (${plan.value.mode})`;
        output(flags, "Deploy completed successfully", common_ok(message));
    }
});
