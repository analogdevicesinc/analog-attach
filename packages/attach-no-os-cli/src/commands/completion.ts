import { buildCommand } from "@stricli/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { common_ok } from "../protocol/responses";
import { output, output_error } from "./shared";

/**
 * `attach-noos completion [<shell>] [--install | --uninstall]` — tab-completion in the
 * user's own shell.
 *
 * Bare, it prints the shell's script, to source or eval. --install writes it where that
 * shell picks completion up for the user, and --uninstall removes it, so only those two
 * change anything on the system. The shell is the one named, else the one in $SHELL.
 *
 * Every script calls `attach-noos complete`, so the three shells offer the same lists.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The scripts' folder: dist/completion next to the bundle once built (the build copies it
 * there), else the package's own completion/ folder, seen from dist/ or from src/commands/.
 */
function scripts_folder(): string {
    const candidates = [
        path.join(__dirname, "completion"),
        path.join(__dirname, "../completion"),
        path.join(__dirname, "../../completion"),
    ];
    return candidates.find(candidate => fs.existsSync(path.join(candidate, "attach-noos.bash"))) ?? candidates[0];
}

type Shell = "bash" | "fish" | "zsh";
const SHELLS: readonly Shell[] = ["bash", "fish", "zsh"];

/** Where each shell's script lives in the package, and where it is installed for the user. */
const TARGETS: Record<Shell, { script: string, installed: () => string, after: string }> = {
    bash: {
        script: "attach-noos.bash",
        installed: () => path.join(os.homedir(), ".local/share/bash-completion/completions/attach-noos"),
        after: "Open a new shell (bash-completion loads it from there).",
    },
    fish: {
        script: "attach-noos.fish",
        installed: () => path.join(os.homedir(), ".config/fish/completions/attach-noos.fish"),
        after: "Open a new shell (fish loads it from there).",
    },
    zsh: {
        script: "_attach-noos",
        installed: () => path.join(os.homedir(), ".zsh/completions/_attach-noos"),
        after: "Make sure ~/.zshrc has, before compinit:\n  fpath=(~/.zsh/completions $fpath)\n  autoload -Uz compinit && compinit\nthen open a new shell.",
    },
};

type CompletionFlags = { json?: boolean; install?: boolean; uninstall?: boolean };

function shell_from_environment(): Shell | undefined {
    const name = path.basename(process.env.SHELL ?? "");
    return SHELLS.find(shell => shell === name);
}

export const completionCommand = buildCommand<CompletionFlags, [string | undefined]>({
    docs: {
        brief: "Print or install shell completion (bash, fish, zsh)",
        fullDescription:
            "Prints the completion script for <shell> (default: the shell in $SHELL), to source or eval:\n" +
            "  bash:  source <(attach-noos completion bash)\n" +
            "  fish:  attach-noos completion fish | source\n" +
            "  zsh:   eval \"$(attach-noos completion zsh)\"\n" +
            "--install writes it where the shell loads it for your user; --uninstall removes it."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "shell", brief: "bash, fish or zsh (default: from $SHELL)", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        return SHELLS.filter(shell => shell.startsWith(partial));
                    }
                }
            ]
        },
        flags: {
            install: { kind: "boolean", brief: "Install it for your user", optional: true },
            uninstall: { kind: "boolean", brief: "Remove the installed script", optional: true },
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, named) => {
        const shell = named === undefined ? shell_from_environment() : SHELLS.find(candidate => candidate === named);
        if (shell === undefined) {
            output_error(flags, named === undefined
                ? `Cannot tell the shell from $SHELL ('${process.env.SHELL ?? ""}'): pass one of ${SHELLS.join(", ")}`
                : `Unknown shell '${named}': pass one of ${SHELLS.join(", ")}`);
            return;
        }
        if (flags.install === true && flags.uninstall === true) {
            output_error(flags, "Pass --install or --uninstall, not both");
            return;
        }

        const target = TARGETS[shell];
        const source = path.join(scripts_folder(), target.script);
        // Resolved now, not at load: the home directory is the one of this run.
        const installed = target.installed();
        if (!fs.existsSync(source)) {
            output_error(flags, `Completion script not found at '${source}'. This is a packaging issue.`);
            return;
        }

        if (flags.uninstall === true) {
            if (!fs.existsSync(installed)) {
                // Not installed is the state that was asked for, so this is a success.
                const message = `No ${shell} completion at '${installed}'; nothing to remove`;
                output(flags, message, common_ok(message));
                return;
            }
            try {
                fs.unlinkSync(installed);
            } catch (error) {
                output_error(flags, `Failed to remove '${installed}': ${String(error)}`);
                return;
            }
            const message = `Removed the ${shell} completion from ${installed}`;
            output(flags, `${message}\nOpen a new shell for the change to take effect.`, common_ok(message));
            return;
        }

        const script = fs.readFileSync(source, "utf8");
        if (flags.install !== true) {
            // The script itself on stdout, nothing else, so it can be sourced as it is.
            output(flags, script.trimEnd(), { ...common_ok(`${shell} completion script`), shell, script });
            return;
        }

        try {
            fs.mkdirSync(path.dirname(installed), { recursive: true });
            fs.writeFileSync(installed, script);
        } catch (error) {
            output_error(flags, `Failed to install the ${shell} completion: ${String(error)}`);
            return;
        }
        const message = `Installed the ${shell} completion to ${installed}`;
        output(flags, `${message}\n${target.after}`, common_ok(message));
    }
});
