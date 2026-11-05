// `skill install <name> [--force]` and `skill uninstall <name>`: copy one of the active
// backend's skills (`Backend.skills`) to `~/.claude/skills/<name>/`, or remove it. Ported
// from attach-cli's skill command (spec 03-commands/skill.md), with a name per skill. With no
// name, either lists the backend's skills and whether each is installed. Neither reads the
// workspace.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { answer, input_error, refuse, type Outcome, type SkillSpec } from "../interface/backend-interface";
import type { CommonResponse } from "../interface/backend-responses";
import type { FrontEnd, Route } from "./routes";

/** SKILL-001's check: `claude --version` runs. */
export function claude_on_path(): boolean {
    try {
        execSync("claude --version", { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

export interface SkillResponse extends CommonResponse {
    /** The skill's directory under `~/.claude/skills/`. */
    path: string;
}

/** `skill install` or `skill uninstall` with no name: the backend's skills. */
export interface SkillListResponse extends CommonResponse {
    skills: { name: string, about: string, installed: boolean, path: string }[];
}

export function skill_directory(home: string, name: string): string {
    return path.join(home, ".claude", "skills", name);
}

/** Installed: the skill directory has a `SKILL.md`. */
function installed(directory: string): boolean {
    return fs.existsSync(path.join(directory, "SKILL.md"));
}

/** The backend's skill named `name`, or why there is none. */
function find_skill(front: FrontEnd, name: string | undefined): SkillSpec | Outcome<never> {
    const { backend } = front;
    if (backend === undefined) { return input_error(front.backend_problem ?? "No backend is set."); }
    const names = backend.skills.map(skill => skill.name);
    if (names.length === 0) { return input_error(`The ${backend.id} backend has no skills`); }
    const skill = backend.skills.find(candidate => candidate.name === name);
    return skill ?? refuse(`Unknown skill: ${name ?? ""}. Skills of the ${backend.id} backend: ${names.join(", ")}`, { type: "unknown-choice" });
}

/** The backend's skills, each with what it helps with and whether it is installed (`verb`: install, uninstall). */
export function list_skills(front: FrontEnd, verb: string): Outcome<SkillListResponse> {
    const { backend } = front;
    if (backend === undefined) { return input_error(front.backend_problem ?? "No backend is set."); }
    const skills = backend.skills.map(skill => {
        const directory = skill_directory(front.home, skill.name);
        return { name: skill.name, about: skill.about, installed: installed(directory), path: directory };
    });
    const message = skills.length === 0 ? `The ${backend.id} backend has no skills`
        : `Skills of the ${backend.id} backend: ${skills.map(skill => skill.name).join(", ")}`;
    const width = Math.max(0, ...skills.map(skill => skill.name.length));
    const text = [
        `Skills of the ${backend.id} backend:`,
        ...skills.map(skill => `  ${skill.name.padEnd(width)}  ${skill.about}${skill.installed ? " (installed)" : ""}`),
        "",
        `${verb === "install" ? "Install" : "Remove"} one with: ${front.program} skill ${verb} <name>`,
    ].join("\n");
    return answer({ ok: true, message, severity: "info", skills }, text);
}

export function install_skill(front: FrontEnd, name: string | undefined, force: boolean): Outcome<SkillResponse | SkillListResponse> {
    if (name === undefined) { return list_skills(front, "install"); }
    const skill = find_skill(front, name);
    if ("kind" in skill) { return skill; }
    if (!front.claude_installed()) {
        return refuse("Claude Code is not installed. Install it from: https://claude.ai/code", {
            type: "tool-missing",
            text: "Claude Code is not installed.\nInstall it from: https://claude.ai/code",
        });
    }
    const directory = skill_directory(front.home, skill.name);
    if (installed(directory) && !force) {
        return refuse(`Skill ${skill.name} is already installed. Use --force to overwrite.`, {
            type: "needs-force",
            text: `Skill ${skill.name} is already installed.\nUse --force to overwrite.`,
        });
    }
    if (!fs.existsSync(path.join(skill.source_dir, "SKILL.md"))) { throw new Error(`SKILL.md not found at ${skill.source_dir}`); }
    // Files of the user's next to the skill's are kept (SKILL-003).
    fs.mkdirSync(directory, { recursive: true });
    fs.cpSync(skill.source_dir, directory, { recursive: true, force: true });
    return answer(
        { ok: true, message: `Installed skill ${skill.name} to ${directory}`, severity: "info", path: directory },
        `\nSkill ${skill.name} installed successfully!\n\nClaude Code now helps with ${skill.about}.\n`,
    );
}

export function uninstall_skill(front: FrontEnd, name: string | undefined): Outcome<SkillResponse | SkillListResponse> {
    if (name === undefined) { return list_skills(front, "uninstall"); }
    const skill = find_skill(front, name);
    if ("kind" in skill) { return skill; }
    const directory = skill_directory(front.home, skill.name);
    if (!installed(directory)) { return refuse(`Skill ${skill.name} is not installed.`, { type: "not-found" }); }
    fs.rmSync(directory, { recursive: true });
    return answer(
        { ok: true, message: `Removed skill ${skill.name} from ${directory}`, severity: "info", path: directory },
        `\nSkill ${skill.name} uninstalled successfully.\n`,
    );
}

function name_of(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

export function skill_routes(front: FrontEnd): Route[] {
    const skills = front.backend?.skills ?? [];
    const listed = skills.length === 0 ? "" : `\n\nSkills: ${skills.map(skill => `${skill.name} (${skill.about})`).join(", ")}.`;
    const name_positional = { name: "name", placeholder: "name", brief: "The skill (none: list the backend's skills)", optional: true };
    const example = skills[0]?.name ?? "<name>";
    const examples = (verb: string, extra = ""): string => `\n\nExamples:\n  $ ${front.program} skill ${verb} ${example}${extra}`;
    const complete = (index: number): Promise<{ candidates: { value: string; description: string }[] } | undefined> =>
        Promise.resolve(index === 0 ? { candidates: skills.map(skill => ({ value: skill.name, description: skill.about })) } : undefined);
    return [
        {
            path: ["skill", "install"],
            brief: "Install a Claude Code skill of the backend",
            full: `Install a Claude Code skill of the backend into ~/.claude/skills/<name>/. With no name, list the backend's skills and whether each is installed.${listed}${examples("install")}\n  $ ${front.program} skill install ${example} --force\n  $ ${front.program} skill install`,
            group: "tooling",
            positionals: [name_positional],
            flags: { force: { kind: "boolean", brief: "Install over an installed copy" } },
            asks: false,
            supported: true,
            run: input => Promise.resolve(install_skill(front, name_of(input.positionals["name"]), input.flags["force"] === true)),
            complete,
        },
        {
            path: ["skill", "uninstall"],
            brief: "Remove an installed Claude Code skill",
            full: `Remove a skill of the backend from ~/.claude/skills/<name>/. With no name, list the backend's skills and whether each is installed.${listed}${examples("uninstall")}\n  $ ${front.program} skill uninstall`,
            group: "tooling",
            positionals: [name_positional],
            flags: {},
            asks: false,
            supported: true,
            run: input => Promise.resolve(uninstall_skill(front, name_of(input.positionals["name"]))),
            complete,
        },
    ];
}
