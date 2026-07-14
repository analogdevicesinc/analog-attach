import { buildCommand, buildRouteMap } from "@stricli/core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPLETION_SCRIPT_PATH = path.join(__dirname, "../completion/aa.bash");
const SYSTEM_COMPLETION_DIR = "/etc/bash_completion.d";
const USER_COMPLETION_DIR = path.join(process.env.HOME ?? "~", ".local/share/bash-completion/completions");

const installCommand = buildCommand<{ json?: boolean; user?: boolean }, []>({
    docs: { brief: "Install bash completion for aa" },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            user: { kind: "boolean", brief: "Install to user directory instead of system-wide", optional: true }
        }
    },
    func: async (flags) => {
        const target_directory = flags.user ? USER_COMPLETION_DIR : SYSTEM_COMPLETION_DIR;
        const target_path = path.join(target_directory, "aa");

        // Check if source script exists
        if (!fs.existsSync(COMPLETION_SCRIPT_PATH)) {
            const error = "Completion script not found. This may be a packaging issue.";
            if (flags.json) {
                console.log(JSON.stringify({ ok: false, error }));
            } else {
                console.error(`Error: ${error}`);
            }
            // eslint-disable-next-line unicorn/no-process-exit
            process.exit(1);
        }

        // Create target directory if needed (for user install)
        if (flags.user && !fs.existsSync(target_directory)) {
            try {
                fs.mkdirSync(target_directory, { recursive: true });
            } catch (error_) {
                const error = `Failed to create directory ${target_directory}: ${error_}`;
                if (flags.json) {
                    console.log(JSON.stringify({ ok: false, error }));
                } else {
                    console.error(`Error: ${error}`);
                }
                // eslint-disable-next-line unicorn/no-process-exit
                process.exit(1);
            }
        }

        // Copy the completion script
        try {
            const script = fs.readFileSync(COMPLETION_SCRIPT_PATH, "utf8");
            fs.writeFileSync(target_path, script);
        } catch (error_) {
            const is_permission_error = (error_ as NodeJS.ErrnoException).code === "EACCES";
            if (is_permission_error && !flags.user) {
                const error = `Permission denied. Try with sudo or use --user for user-local install.`;
                if (flags.json) {
                    console.log(JSON.stringify({ ok: false, error }));
                } else {
                    console.error(`Error: ${error}`);
                    console.error(`\n  sudo aa completion install\n  or\n  aa completion install --user`);
                }
            } else {
                const error = `Failed to install completion script: ${error_}`;
                if (flags.json) {
                    console.log(JSON.stringify({ ok: false, error }));
                } else {
                    console.error(`Error: ${error}`);
                }
            }
            // eslint-disable-next-line unicorn/no-process-exit
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ ok: true, path: target_path }));
        } else {
            console.log(`Completion script installed to ${target_path}`);
            console.log(`\nRestart your shell or run:\n  source ${target_path}`);
        }
    }
});

const uninstallCommand = buildCommand<{ json?: boolean; user?: boolean }, []>({
    docs: { brief: "Uninstall bash completion for aa" },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            user: { kind: "boolean", brief: "Uninstall from user directory", optional: true }
        }
    },
    func: async (flags) => {
        const target_directory = flags.user ? USER_COMPLETION_DIR : SYSTEM_COMPLETION_DIR;
        const target_path = path.join(target_directory, "aa");

        if (!fs.existsSync(target_path)) {
            if (flags.json) {
                console.log(JSON.stringify({ ok: true, message: "Completion script not installed" }));
            } else {
                console.log("Completion script not installed.");
            }
            return;
        }

        try {
            fs.unlinkSync(target_path);
        } catch (error_) {
            const is_permission_error = (error_ as NodeJS.ErrnoException).code === "EACCES";
            if (is_permission_error && !flags.user) {
                const error = `Permission denied. Try with sudo.`;
                if (flags.json) {
                    console.log(JSON.stringify({ ok: false, error }));
                } else {
                    console.error(`Error: ${error}`);
                    console.error(`\n  sudo aa completion uninstall`);
                }
            } else {
                const error = `Failed to uninstall completion script: ${error_}`;
                if (flags.json) {
                    console.log(JSON.stringify({ ok: false, error }));
                } else {
                    console.error(`Error: ${error}`);
                }
            }
            // eslint-disable-next-line unicorn/no-process-exit
            process.exit(1);
        }

        if (flags.json) {
            console.log(JSON.stringify({ ok: true, path: target_path }));
        } else {
            console.log(`Completion script removed from ${target_path}`);
            console.log(`\nRestart your shell for changes to take effect.`);
        }
    }
});

export const completionCommand = buildRouteMap({
    routes: {
        install: installCommand,
        uninstall: uninstallCommand,
    },
    docs: {
        brief: "Manage shell completion",
    },
});
