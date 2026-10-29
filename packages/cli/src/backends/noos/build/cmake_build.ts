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

import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";

import { error, ok } from "attach-no-os-lib";
import type { Result } from "attach-no-os-lib";

/** What the capi reference apps declare (`cmake_minimum_required(VERSION 3.27)`). */
const REQUIRED_CMAKE = [3, 27, 0] as const;

const PRESETS_FILENAME = "CMakePresets.json";

/** Where the generated presets configure into (`"binaryDir": "${sourceDir}/build"`). */
const BUILD_DIRECTORY = "build";

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
		return error(`No ${PRESETS_FILENAME} in ${project_path}. Is this a generated project? Run: ${program} generate`, file);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return error(`${file} is not valid JSON`, file);
	}
	const presets = (parsed as { configurePresets?: unknown }).configurePresets;
	if (!Array.isArray(presets)) {
		return error(`${file} has no configurePresets`, file);
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
		return error(`No CMakeLists.txt in ${project_path}`, file);
	}
	const match = /^\s*project\(\s*([A-Za-z0-9_]+)/m.exec(fs.readFileSync(file, "utf8"));
	if (match?.[1] === undefined) {
		return error(`${file} declares no project()`, file);
	}
	return ok(match[1]);
}

/**
 * What to build: the project's board preset (the only one, or the one named), its target,
 * and the environment with CAPI_DIR set.
 */
export function plan_build(project_path: string, capi_path: string, board_override: string | undefined, program: string): Result<BuildPlan> {
	const presets = read_presets(project_path, program);
	if (!presets.ok) {
		return presets;
	}

	let preset: Preset | undefined;
	if (board_override === undefined) {
		const [only, ...more] = presets.value;
		if (only === undefined || more.length > 0) {
			const names = presets.value.map(entry => entry.name).join(", ") || "none";
			return error(`The project has ${String(presets.value.length)} board presets (${names}); pass --board to pick one`, PRESETS_FILENAME);
		}
		preset = only;
	} else {
		preset = presets.value.find(entry => entry.name === board_override);
		if (preset === undefined) {
			const names = presets.value.map(entry => entry.name).join(", ");
			return error(`The project has no preset for board '${board_override}'. It has: ${names}. Regenerate it for that board.`, PRESETS_FILENAME);
		}
	}

	const target = project_target(project_path);
	if (!target.ok) {
		return target;
	}

	const binary_directory = path.join(project_path, BUILD_DIRECTORY);
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
	const cmake = tool_version("cmake", ["--version"]);
	if (cmake === undefined) {
		return error(`cmake was not found on PATH. Install CMake ${REQUIRED_CMAKE.join(".")} or newer.`, "cmake");
	}
	const version = /(\d+)\.(\d+)\.(\d+)/.exec(cmake);
	if (version) {
		const found = [Number(version[1]), Number(version[2]), Number(version[3])];
		const as_number = (parts: readonly number[]) => (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 1000 + (parts[2] ?? 0);
		if (as_number(found) < as_number(REQUIRED_CMAKE)) {
			return error(`CMake ${found.join(".")} is too old; CAPI apps need ${REQUIRED_CMAKE.join(".")} or newer.`, "cmake");
		}
	}

	// The generated preset names Ninja as its generator.
	if (tool_version("ninja", ["--version"]) === undefined) {
		return error("ninja was not found on PATH, and the generated preset uses it as the generator. Install it (apt install ninja-build).", "ninja");
	}

	if (!fs.existsSync(path.join(capi_path, SDK_ENTRY))) {
		return error(`${capi_path} is not a capi checkout: it has no ${SDK_ENTRY}. Check the capi-path setting.`, "capi_path");
	}

	const required = PLATFORM_ENVIRONMENT[plan.platform];
	if (required !== undefined) {
		const value = plan.environment[required.variable];
		if (value === undefined || !fs.existsSync(value)) {
			return error(`${required.variable} is ${value === undefined ? "not set" : `'${value}', which does not exist`}. ${required.hint}`, required.variable);
		}
	}

	return ok();
}

export type CommandResult = { exit_code: number };

/** Where a child's output goes, line by line, and what stops it. */
export interface OutputSink {
	line(text: string): void;
	readonly signal?: AbortSignal;
}

/**
 * Run a command, its output (stdout and stderr, as they come) passed on line by line.
 * Configure output is never swallowed on purpose: Kconfig reports an unsatisfied
 * `depends on` as a warning there, the earliest sign that project.conf is missing a symbol.
 */
export function run(command: string, arguments_: string[], cwd: string, sink: OutputSink, environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
	return watch(spawn(command, arguments_, {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
		...(environment === undefined ? {} : { env: environment }),
		...(sink.signal === undefined ? {} : { signal: sink.signal }),
	}), sink);
}

/** Run a shell string, for the `build-command`/`deploy-command` override. */
export function run_shell(command: string, cwd: string, sink: OutputSink): Promise<CommandResult> {
	return watch(spawn(command, [], {
		cwd,
		shell: true,
		stdio: ["ignore", "pipe", "pipe"],
		...(sink.signal === undefined ? {} : { signal: sink.signal }),
	}), sink);
}

function watch(child: ChildProcessByStdio<null, Readable, Readable>, sink: OutputSink): Promise<CommandResult> {
	return new Promise((resolve) => {
		const pending = { stdout: "", stderr: "" };
		const pass = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
			const lines = (pending[stream] + chunk.toString("utf8")).split(/\r?\n/);
			pending[stream] = lines.pop() ?? "";
			for (const line of lines) {
				sink.line(line);
			}
		};
		child.stdout.on("data", pass("stdout"));
		child.stderr.on("data", pass("stderr"));
		child.on("close", (code) => {
			for (const rest of [pending.stdout, pending.stderr]) {
				if (rest !== "") {
					sink.line(rest);
				}
			}
			resolve({ exit_code: code ?? 1 });
		});
		child.on("error", () => { resolve({ exit_code: 1 }); });
	});
}

export function configure_arguments(plan: BuildPlan, extra: string[] = []): string[] {
	return ["--preset", plan.board, ...extra];
}

export function build_arguments(plan: BuildPlan, target?: string): string[] {
	return ["--build", plan.binary_directory, ...(target === undefined ? [] : ["--target", target])];
}
