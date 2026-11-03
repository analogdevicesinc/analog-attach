/**
 * Building a generated CAPI application.
 *
 * A generated app is a self-contained CMake project: its CMakePresets.json names the board,
 * and the capi SDK resolves the platform and every dependency from its module.yml. So a build
 * runs inside the project directory, the way the capi-noos reference apps are built:
 *
 *   cmake --preset <board>        configure into <project>/build
 *   cmake --build build           build (the ELF, .hex and .bin)
 *   cmake --build build --target flash
 *
 * The only thing the build needs from outside is CAPI_DIR, which is the `capi-path` setting,
 * plus whatever the platform's own toolchain needs (MAXIM_SDK_PATH for maxim).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import os from "node:os";
import { DEFAULT_BUILD_DIR, error, get_effective_setting_value, ok } from "attach-no-os-lib";
import type { ErrorType, Result } from "attach-no-os-lib";

/** What the capi reference apps declare (`cmake_minimum_required(VERSION 3.27)`). */
const REQUIRED_CMAKE = [3, 27, 0] as const;

const PRESETS_FILENAME = "CMakePresets.json";

/** Where the generated presets configure into (`"binaryDir": "${sourceDir}/build"`). */

/** The capi SDK file a CAPI app's CMakeLists.txt includes first. */
const SDK_ENTRY = path.join("sdk", "cmake", "capi_create_application.cmake");

/**
 * Environment a platform's toolchain needs, which no generated file can carry, keyed by the
 * preset's PLATFORM. capi-maxim's toolchain.cmake refuses to configure without it.
 */
const PLATFORM_ENVIRONMENT: Record<string, { variable: string, hint: string }> = {
	maxim: {
		variable: "MAXIM_SDK_PATH",
		hint: "Set MAXIM_SDK_PATH to the MaximSDK install (the directory holding Libraries/ and Tools/).",
	},
};

export type BuildPlan = {
	/** The CMake target, which names the ELF. */
	target: string;
	/** The configure preset: the board. */
	board: string;
	/** The preset's PLATFORM: maxim, stm32, ... */
	platform: string;
	project_directory: string;
	binary_directory: string;
	elf_path: string;
	/** The process environment plus CAPI_DIR. */
	environment: NodeJS.ProcessEnv;
};

type Preset = { name: string, platform: string };

function read_presets(project_path: string, program: string): Result<Preset[]> {
	const file = path.join(project_path, PRESETS_FILENAME);
	if (!fs.existsSync(file)) {
		return error(`No ${PRESETS_FILENAME} in ${project_path}. Is this a generated project? Run: ${program} generate`, "not-generated", file);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return error(`${file} is not valid JSON`, "parse-error", file);
	}
	const presets = (parsed as { configurePresets?: unknown }).configurePresets;
	if (!Array.isArray(presets)) {
		return error(`${file} has no configurePresets`, "parse-error", file);
	}
	return ok(presets.flatMap(preset => {
		const { name, hidden, cacheVariables } = preset as { name?: unknown, hidden?: unknown, cacheVariables?: Record<string, unknown> };
		const platform = cacheVariables?.["PLATFORM"];
		return typeof name === "string" && hidden !== true
			? [{ name, platform: typeof platform === "string" ? platform : "" }]
			: [];
	}));
}

/** The CMake target the project declares: `project(<target> ...)` in its CMakeLists.txt. */
function project_target(project_path: string): Result<string> {
	const file = path.join(project_path, "CMakeLists.txt");
	if (!fs.existsSync(file)) {
		return error(`No CMakeLists.txt in ${project_path}`, "not-generated", file);
	}
	const match = /^\s*project\(\s*([A-Za-z0-9_]+)/m.exec(fs.readFileSync(file, "utf8"));
	if (match?.[1] === undefined) {
		return error(`${file} declares no project()`, "parse-error", file);
	}
	return ok(match[1]);
}

/**
 * What to build: the project's board preset (a generated project has one, for the board it was
 * generated for), its target, and the environment with CAPI_DIR set.
 */
export function plan_build(project_path: string, capi_path: string, program: string): Result<BuildPlan> {
	const presets = read_presets(project_path, program);
	if (!presets.ok) {
		return presets;
	}

	const [preset, ...more] = presets.value;
	if (preset === undefined || more.length > 0) {
		const names = presets.value.map(entry => entry.name).join(", ") || "none";
		return error(`The project has ${String(presets.value.length)} board presets (${names}), not the one a generated project has. Generate it again: ${program} generate`, "not-generated", PRESETS_FILENAME);
	}

	const target = project_target(project_path);
	if (!target.ok) {
		return target;
	}

	const binary_directory = build_directory(project_path);
	return ok({
		target: target.value,
		board: preset.name,
		platform: preset.platform,
		project_directory: project_path,
		binary_directory,
		elf_path: path.join(binary_directory, `${target.value}.elf`),
		environment: { ...process.env, CAPI_DIR: capi_path },
	});
}

/**
 * Where the project is built: the `build-dir` setting, relative to the project unless absolute
 * (`~` the home directory), else `build`. Several can sit side by side (SET-11).
 */
function build_directory(project_path: string): string {
	const setting = get_effective_setting_value("build-dir");
	const configured = setting.ok && setting.value !== undefined && setting.value !== "" ? setting.value : DEFAULT_BUILD_DIR;
	const expanded = configured === "~" || configured.startsWith("~/") ? path.join(os.homedir(), configured.slice(1)) : configured;
	return path.resolve(project_path, expanded);
}

function tool_version(command: string, arguments_: string[]): string | undefined {
	try {
		return execFileSync(command, arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		return undefined;
	}
}

/**
 * Check what would otherwise fail late and confusingly, with a message saying what to fix:
 * the tools, the capi checkout, and the platform toolchain's environment.
 */
export function preflight(plan: BuildPlan, capi_path: string): Result<void> {
	// Every problem at once, so one run says all there is to fix (BUILD-02).
	const problems: { message: string, path: string, type: ErrorType }[] = [];
	const cmake = tool_version("cmake", ["--version"]);
	if (cmake === undefined) {
		problems.push({ message: `cmake was not found on PATH. Install CMake ${REQUIRED_CMAKE.join(".")} or newer.`, path: "cmake", type: "tool-missing" });
	} else {
		const version = /(\d+)\.(\d+)\.(\d+)/.exec(cmake);
		if (version) {
			const found = [Number(version[1]), Number(version[2]), Number(version[3])];
			const as_number = (parts: readonly number[]) => (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 1000 + (parts[2] ?? 0);
			if (as_number(found) < as_number(REQUIRED_CMAKE)) {
				problems.push({ message: `CMake ${found.join(".")} is too old; CAPI apps need ${REQUIRED_CMAKE.join(".")} or newer.`, path: "cmake", type: "tool-missing" });
			}
		}
	}

	// The generated preset names Ninja as its generator.
	if (tool_version("ninja", ["--version"]) === undefined) {
		problems.push({ message: "ninja was not found on PATH, and the generated preset uses it as the generator. Install it (apt install ninja-build).", path: "ninja", type: "tool-missing" });
	}

	if (!fs.existsSync(path.join(capi_path, SDK_ENTRY))) {
		problems.push({ message: `${capi_path} is not a capi checkout: it has no ${SDK_ENTRY}. Check the capi-path setting.`, path: "capi_path", type: "invalid-source" });
	}

	const required = PLATFORM_ENVIRONMENT[plan.platform];
	if (required !== undefined) {
		const value = plan.environment[required.variable];
		if (value === undefined || !fs.existsSync(value)) {
			problems.push({ message: `${required.variable} is ${value === undefined ? "not set" : `'${value}', which does not exist`}. ${required.hint}`, path: required.variable, type: "tool-missing" });
		}
	}

	const [first] = problems;
	return first === undefined ? ok() : error(problems.map(problem => problem.message).join(" "), first.type, first.path);
}

/** The board's preset, configured into the build directory (`-B` overrides the preset's binaryDir). */
export function configure_arguments(plan: BuildPlan, extra: string[] = []): string[] {
	return ["--preset", plan.board, "-B", plan.binary_directory, ...extra];
}

export function build_arguments(plan: BuildPlan, target?: string): string[] {
	return ["--build", plan.binary_directory, ...(target === undefined ? [] : ["--target", target])];
}
