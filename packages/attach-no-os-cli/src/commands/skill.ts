import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCommand, buildRouteMap } from "@stricli/core";
import { common_ok } from "../protocol/responses";
import { output, output_error } from "./shared";

/**
 * `attach-noos skill install|uninstall <name>` — the AI-assistant skill for an ecosystem.
 *
 * A skill is a SKILL.md that teaches an assistant (Claude Code) to drive the CLI for one
 * ecosystem: its commands, its workflow, what to ask the user. Each ecosystem has its own
 * (here `capi`), installed under ~/.claude/skills/, where Claude Code finds it.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The skills this CLI ships: the name `skill install` takes, and the folder it installs as. */
const SKILLS: Record<string, { folder: string, about: string }> = {
    capi: { folder: "attach-noos-capi", about: "configuring, generating and building CAPI projects" },
};

/**
 * The packaged skills' folder: dist/skills next to the bundle once built (the build copies
 * it there), else the package's own skills/ folder, seen from dist/ or from src/commands/.
 */
function skills_folder(): string {
    const candidates = [
        path.join(__dirname, "skills"),
        path.join(__dirname, "../skills"),
        path.join(__dirname, "../../skills"),
    ];
    return candidates.find(candidate => fs.existsSync(path.join(candidate, "capi", "SKILL.md"))) ?? candidates[0];
}

/** Where a skill is installed, resolved per run so it follows the home directory of that run. */
function installed_path(name: string): string {
    return path.join(os.homedir(), ".claude", "skills", SKILLS[name]?.folder ?? name, "SKILL.md");
}

function propose_names(partial: string): string[] {
    return Object.keys(SKILLS).filter(name => name.startsWith(partial));
}

function unknown(name: string): string {
    return `No skill called '${name}' here. Available: ${Object.keys(SKILLS).join(", ")}`;
}

const name_parameter = {
    kind: "tuple",
    parameters: [
        {
            placeholder: "name", brief: `The skill: ${Object.keys(SKILLS).join(", ")}`, parse: String,
            proposeCompletions(partial: string) {
                return propose_names(partial);
            }
        }
    ]
} as const;

const installCommand = buildCommand<{ json?: boolean, force?: boolean }, [string]>({
    docs: { brief: "Install an ecosystem's skill for Claude Code" },
    parameters: {
        positional: name_parameter,
        flags: {
            force: { kind: "boolean", brief: "Overwrite an installed copy", optional: true },
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, name) => {
        const skill = SKILLS[name];
        if (skill === undefined) {
            output_error(flags, unknown(name));
            return;
        }
        const source = path.join(skills_folder(), name, "SKILL.md");
        if (!fs.existsSync(source)) {
            output_error(flags, `Skill not found at '${source}'. This is a packaging issue.`);
            return;
        }

        const target = installed_path(name);
        if (fs.existsSync(target) && flags.force !== true) {
            const message = `The ${name} skill is already installed at ${target}; pass --force to overwrite it`;
            output_error(flags, message);
            return;
        }

        try {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
        } catch (error) {
            output_error(flags, `Failed to install the ${name} skill: ${String(error)}`);
            return;
        }
        const message = `Installed the ${name} skill to ${target}`;
        output(flags, `${message}\nClaude Code now helps with ${skill.about} (start a new session to load it).`, { ...common_ok(message), path: target });
    }
});

const uninstallCommand = buildCommand<{ json?: boolean }, [string]>({
    docs: { brief: "Remove an installed skill" },
    parameters: {
        positional: name_parameter,
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, name) => {
        if (SKILLS[name] === undefined) {
            output_error(flags, unknown(name));
            return;
        }
        const target = installed_path(name);
        if (!fs.existsSync(target)) {
            // Not installed is the state that was asked for, so this is a success.
            const message = `The ${name} skill is not installed; nothing to remove`;
            output(flags, message, common_ok(message));
            return;
        }
        try {
            fs.rmSync(path.dirname(target), { recursive: true, force: true });
        } catch (error) {
            output_error(flags, `Failed to remove the ${name} skill: ${String(error)}`);
            return;
        }
        const message = `Removed the ${name} skill from ${path.dirname(target)}`;
        output(flags, message, common_ok(message));
    }
});

export const skillRoutes = buildRouteMap({
    routes: {
        install: installCommand,
        uninstall: uninstallCommand,
    },
    docs: {
        brief: "Install or remove the AI-assistant skill for an ecosystem",
    },
});
