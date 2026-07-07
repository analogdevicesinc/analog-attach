import { buildCommand } from "@stricli/core";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { get_setting_value } from "attach-no-os-lib";
import { output, output_error } from "./shared";

// definition because otherwise it clashes with the stricli function
export const buildCommandDefinition = buildCommand<
    { json?: boolean },
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
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
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

        const build_command_result = get_setting_value("build_command");
        const build_command = build_command_result.ok ? build_command_result.value : "make";

        if (!flags.json) {
            console.log(`Building project in ${target_path}`);
            console.log(`Running: ${build_command}\n`);
        }

        const result = await run_command(build_command, target_path);

        if (result.exit_code !== 0) {
            output_error(flags, "build_failed", `Build failed with exit code ${result.exit_code}`);
            return;
        }

        const text = `Build completed successfully`;
        const json = {
            project_path: target_path,
            command: build_command,
            exit_code: result.exit_code
        };

        output(flags, text, json);
    }
});

type CommandResult = {
    exit_code: number;
    stdout: string;
    stderr: string;
};

function run_command(command: string, cwd: string): Promise<CommandResult> {
    return new Promise((resolve) => {
        const child = spawn(command, [], {
            cwd,
            shell: true,
            stdio: "inherit"
        });

        child.on("close", (code) => {
            resolve({
                exit_code: code ?? 1,
                stdout: "",
                stderr: ""
            });
        });

        child.on("error", () => {
            resolve({
                exit_code: 1,
                stdout: "",
                stderr: ""
            });
        });
    });
}
