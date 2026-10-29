import { DEFAULT_PROBE, PROBE_OPTIONS, get_effective_setting_value, get_setting_value } from "attach-no-os-lib";
import {
    answer,
    command,
    input_error,
    refuse,
    type DeployArguments,
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
import { common_ok, type CommonResponse } from "../protocol/responses";
import { project_directory } from "./build";

// The platform SDK names the flash target `flash` (capi-maxim sdk/flash.cmake), not after the project.
const FLASH_TARGET = "flash";

const DEPLOY_FLAGS = {
    board: { kind: "value", brief: "Deploy to this board instead of the one the project was generated for", placeholder: "board" },
    probe: { kind: "value", brief: `Debug probe used to flash: ${PROBE_OPTIONS.join(" or ")} (default: the 'probe' setting)`, placeholder: "probe" },
} as const satisfies FlagSpecs;

/**
 * `deploy`: flash the built project.
 *
 * Same as `build`: the project comes from settings, and so does the probe, so it runs with
 * no arguments.
 */
export const deploy = command<DeployArguments, CommonResponse, typeof DEPLOY_FLAGS>({
    flags: DEPLOY_FLAGS,
    docs: {
        brief: "Flash the generated CAPI project to the board",
        full:
            "Flashes the project 'generate' writes: the 'project-path' setting, or\n" +
            "out/<project-name> when it is unset."
    },
    run(_arguments, flags, session) {
        return run_deploy(flags.board, flags.probe, session);
    }
});

async function run_deploy(board: string | undefined, probe_flag: string | undefined, session: Session): Promise<Outcome<CommonResponse>> {
    // A probe that can't be is what was typed, whatever the project's state.
    if (probe_flag !== undefined && !PROBE_OPTIONS.includes(probe_flag)) {
        return input_error(`Unknown probe '${probe_flag}'. Supported: ${PROBE_OPTIONS.join(", ")}`);
    }

    const project = project_directory(session);
    if (!project.ok) {
        return project.outcome;
    }
    const target_path = project.path;

    // An explicit deploy-command takes the step over completely.
    const override = get_effective_setting_value("deploy-command");
    if (!override.ok) {
        return refuse(override.error.message);
    }

    if (override.value !== undefined && override.value !== "") {
        const progress = session.progress(`Deploying ${target_path} with '${override.value}'`);
        const result = await run_shell(override.value, target_path, { line: text => { progress.line(text); }, signal: session.signal });
        progress.done();
        if (result.exit_code !== 0) {
            return refuse(`Deploy failed with exit code ${String(result.exit_code)}`);
        }

        const message = `Deployed ${target_path} with '${override.value}'`;
        return answer(common_ok(message), "Deploy completed successfully");
    }

    const configured_probe = get_effective_setting_value("probe");
    if (!configured_probe.ok) {
        return refuse(configured_probe.error.message);
    }

    const probe = probe_flag ?? configured_probe.value ?? DEFAULT_PROBE;
    if (!PROBE_OPTIONS.includes(probe)) {
        return refuse(`Unknown probe '${probe}' in the 'probe' setting. Supported: ${PROBE_OPTIONS.join(", ")}`);
    }

    const capi_path = get_setting_value("capi-path");
    if (!capi_path.ok) {
        return refuse(`capi-path is not configured. Run: ${session.program} config capi-path <path>`);
    }

    const plan = plan_build(target_path, capi_path.value, board, session.program);
    if (!plan.ok) {
        return refuse(plan.error.message);
    }

    const checks = preflight(plan.value, capi_path.value);
    if (!checks.ok) {
        return refuse(checks.error.message);
    }

    const progress = session.progress(`Flashing ${plan.value.target} to ${plan.value.board} via ${probe}`);
    const sink = { line: (text: string) => { progress.line(text); }, signal: session.signal };

    // PROBE is read when the build directory is configured, so configure runs here even
    // if the project was already built. The `flash` target builds what it needs first.
    const { project_directory: directory, environment } = plan.value;
    const configure = await run("cmake", configure_arguments(plan.value, [`-DPROBE=${probe}`]), directory, sink, environment);
    if (configure.exit_code !== 0) {
        progress.done();
        return refuse(`CMake configure failed with exit code ${String(configure.exit_code)}`);
    }

    const flash = await run("cmake", build_arguments(plan.value, FLASH_TARGET), directory, sink, environment);
    progress.done();
    if (flash.exit_code !== 0) {
        return refuse(`Deploy failed with exit code ${String(flash.exit_code)}`);
    }

    const message = `Flashed ${plan.value.target} to ${plan.value.board} via ${probe}`;
    return answer(common_ok(message), "Deploy completed successfully");
}
