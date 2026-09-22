import { buildCommand, buildRouteMap } from "@stricli/core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { common_ok } from "../protocol/responses";
import { output, output_error } from "./shared";

/**
 * `attach-noos completion install|uninstall` — ours alone, not a protocol command.
 *
 * attach-meta drives completion through `list-intelligence`/`suggest` and never calls this;
 * it exists so a person can get tab-completion in their own shell. It still speaks the same
 * response shape as everything else, so `--json` means one thing across the whole CLI.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPLETION_SCRIPT_PATH = path.join(__dirname, "../completion/attach-noos.bash");
const SYSTEM_COMPLETION_DIR = "/etc/bash_completion.d";
const USER_COMPLETION_DIR = path.join(process.env.HOME ?? "~", ".local/share/bash-completion/completions");

type CompletionFlags = { json?: boolean; user?: boolean };

const installCommand = buildCommand<CompletionFlags, []>({
    docs: { brief: "Install bash completion for attach-noos" },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            user: { kind: "boolean", brief: "Install to user directory instead of system-wide", optional: true }
        }
    },
    func: async (flags) => {
        const target_directory = flags.user ? USER_COMPLETION_DIR : SYSTEM_COMPLETION_DIR;
        const target_path = path.join(target_directory, "attach-noos");

        if (!fs.existsSync(COMPLETION_SCRIPT_PATH)) {
            output_error(flags, `Completion script not found at '${COMPLETION_SCRIPT_PATH}'. This is a packaging issue.`);
            return;
        }

        if (flags.user && !fs.existsSync(target_directory)) {
            try {
                fs.mkdirSync(target_directory, { recursive: true });
            } catch (thrown) {
                output_error(flags, `Failed to create directory '${target_directory}': ${thrown}`);
                return;
            }
        }

        try {
            fs.writeFileSync(target_path, fs.readFileSync(COMPLETION_SCRIPT_PATH, "utf8"));
        } catch (thrown) {
            const denied = (thrown as NodeJS.ErrnoException).code === "EACCES";
            if (denied && !flags.user) {
                const message = "Permission denied. Re-run with sudo, or use --user for a user-local install.";
                output_error(flags, message, {
                    text: `${message}\n\n  sudo attach-noos completion install\n  or\n  attach-noos completion install --user`
                });
            } else {
                output_error(flags, `Failed to install completion script: ${thrown}`);
            }
            return;
        }

        const message = `Completion script installed to ${target_path}`;
        output(flags, `${message}\n\nRestart your shell or run:\n  source ${target_path}`, common_ok(message));
    }
});

const uninstallCommand = buildCommand<CompletionFlags, []>({
    docs: { brief: "Uninstall bash completion for attach-noos" },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            user: { kind: "boolean", brief: "Uninstall from user directory", optional: true }
        }
    },
    func: async (flags) => {
        const target_directory = flags.user ? USER_COMPLETION_DIR : SYSTEM_COMPLETION_DIR;
        const target_path = path.join(target_directory, "attach-noos");

        if (!fs.existsSync(target_path)) {
            // Not installed is the state that was asked for, so this is a success.
            const message = `No completion script at '${target_path}'; nothing to remove`;
            output(flags, message, common_ok(message));
            return;
        }

        try {
            fs.unlinkSync(target_path);
        } catch (thrown) {
            const denied = (thrown as NodeJS.ErrnoException).code === "EACCES";
            if (denied && !flags.user) {
                const message = "Permission denied. Re-run with sudo.";
                output_error(flags, message, { text: `${message}\n\n  sudo attach-noos completion uninstall` });
            } else {
                output_error(flags, `Failed to uninstall completion script: ${thrown}`);
            }
            return;
        }

        const message = `Completion script removed from ${target_path}`;
        output(flags, `${message}\n\nRestart your shell for the change to take effect.`, common_ok(message));
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
