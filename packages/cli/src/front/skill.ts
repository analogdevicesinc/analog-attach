// `skill install <name> [--force] [--agent <agent>]` and `skill uninstall <name> [--agent
// <agent>]`: copy one of the active backend's skills (`Backend.skills`) into an AI agent's
// skills directory, or remove it: Claude Code's `~/.claude/skills/<name>/` (the default), Codex
// CLI's `~/.agents/skills/<name>/`, Gemini CLI's `~/.gemini/skills/<name>/`, or each of them
// (`--agent all`). Ported from attach-cli's skill command (spec 03-commands/skill.md), with a
// name per skill. With no name, either lists the backend's skills and whether each is
// installed. Neither reads the workspace.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { answer, input_error, refuse, type Completion, type Outcome, type SkillSpec } from "../interface/backend-interface";
import type { CommonResponse } from "../interface/backend-responses";
import { and_list } from "./config";
import type { FrontEnd, Route } from "./routes";

/** The agents a skill is installed for: each's name, its command, where it reads a user's skills (under the home), and where to get it. */
export const AGENTS = {
	claude: { name: "Claude Code", command: "claude", directory: [".claude", "skills"], site: "https://claude.ai/code" },
	codex: { name: "Codex CLI", command: "codex", directory: [".agents", "skills"], site: "https://developers.openai.com/codex/cli" },
	gemini: { name: "Gemini CLI", command: "gemini", directory: [".gemini", "skills"], site: "https://geminicli.com" },
} as const;
export type Agent = keyof typeof AGENTS;
const AGENT_IDS = Object.keys(AGENTS) as Agent[];
/** `--agent`'s value for every agent. */
const ALL = "all";

/** SKILL-001's check: `<command> --version` runs (`claude --version`). */
export function agent_on_path(agent: Agent): boolean {
	try {
		execSync(`${AGENTS[agent].command} --version`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export interface SkillResponse extends CommonResponse {
	/** The skill's directory, the agent's: `~/.claude/skills/<name>`. */
	path: string;
	agent: Agent;
}

/** `skill install` or `skill uninstall` with `--agent all`: the agents it was done for. */
export interface SkillAgentsResponse extends CommonResponse {
	agents: { agent: Agent; path: string }[];
}

/** `skill install` or `skill uninstall` with no name: the backend's skills, for each agent. */
export interface SkillListResponse extends CommonResponse {
	skills: { name: string; about: string; installed: boolean; path: string; agent: Agent }[];
}

/**
 * A backend's packaged skill (`folder`, the skill's name: `analog-attach-linux`,
 * `analog-attach-noos`), what `SkillSpec.source_dir` is: the
 * repository's own `skills/<folder>/` when the CLI runs from the repository (so an edit is
 * installed with no build), else the copy the build puts in the package (`skills/<folder>/`).
 * `package_root` is the CLI's package directory.
 */
export function packaged_skill(package_root: string, folder: string): string {
	const repository = path.join(package_root, "..", "..", "skills", folder);
	return fs.existsSync(path.join(repository, "SKILL.md")) ? repository : path.join(package_root, "skills", folder);
}

export function skill_directory(home: string, name: string, agent: Agent = "claude"): string {
	return path.join(home, ...AGENTS[agent].directory, name);
}

/** Installed: the skill directory has a `SKILL.md`. */
function installed(directory: string): boolean {
	return fs.existsSync(path.join(directory, "SKILL.md"));
}

/** The agents of `--agent`: `named` when it was given (the messages then name them), `all` for `--agent all`. */
interface AgentChoice { agents: Agent[]; named: boolean; all: boolean; value: string }

/** `--agent`'s `value` (none: Claude Code); another is refused (COM-043). */
function agent_choice(value: string | undefined): AgentChoice | Outcome<never> {
	if (value === undefined) { return { agents: ["claude"], named: false, all: false, value: "claude" }; }
	if (value === ALL) { return { agents: AGENT_IDS, named: true, all: true, value }; }
	if (value in AGENTS) { return { agents: [value as Agent], named: true, all: false, value }; }
	return refuse(`Unknown agent: ${value}. Agents: ${[...AGENT_IDS, ALL].join(", ")}`, { type: "unknown-choice" });
}

/** ` for Codex CLI` when the agents were named (`--agent`), else nothing. */
function for_agents(choice: AgentChoice, agents: readonly Agent[] = choice.agents): string {
	return choice.named ? ` for ${and_list(agents.map(agent => AGENTS[agent].name))}` : "";
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

/** The backend's skills, each with what it helps with and whether it is installed, for each agent of `choice` (`verb`: install, uninstall). */
function list_skills(front: FrontEnd, verb: string, choice: AgentChoice): Outcome<SkillListResponse> {
	const { backend } = front;
	if (backend === undefined) { return input_error(front.backend_problem ?? "No backend is set."); }
	const skills = backend.skills.flatMap(skill => choice.agents.map(agent => {
		const directory = skill_directory(front.home, skill.name, agent);
		return { name: skill.name, about: skill.about, installed: installed(directory), path: directory, agent };
	}));
	const names = backend.skills.map(skill => skill.name);
	const message = names.length === 0 ? `The ${backend.id} backend has no skills`
		: `Skills of the ${backend.id} backend: ${names.join(", ")}`;
	const width = Math.max(0, ...names.map(name => name.length));
	const text = [
		`Skills of the ${backend.id} backend${choice.all ? "" : for_agents(choice)}:`,
		...skills.map(skill => `  ${skill.name.padEnd(width)}  ${skill.about}${choice.all ? ` · ${AGENTS[skill.agent].name}` : ""}${skill.installed ? " (installed)" : ""}`),
		"",
		`${verb === "install" ? "Install" : "Remove"} one with: ${front.program} skill ${verb} <name>${choice.named ? ` --agent ${choice.value}` : ""}`,
	].join("\n");
	return answer({ ok: true, message, severity: "info", skills }, text);
}

/** What install and uninstall answer: the one agent's skill directory, or with `--agent all` each agent's. */
function done_answer(choice: AgentChoice, done: { agent: Agent; path: string }[], message: string, text: string): Outcome<SkillResponse | SkillAgentsResponse> {
	const [first] = done;
	return choice.all || first === undefined
		? answer({ ok: true, message, severity: "info", agents: done }, text)
		: answer({ ok: true, message, severity: "info", path: first.path, agent: first.agent }, text);
}

export function install_skill(front: FrontEnd, name: string | undefined, force: boolean, agent?: string): Outcome<SkillResponse | SkillAgentsResponse | SkillListResponse> {
	const choice = agent_choice(agent);
	if ("kind" in choice) { return choice; }
	if (name === undefined) { return list_skills(front, "install", choice); }
	const skill = find_skill(front, name);
	if ("kind" in skill) { return skill; }
	// The agents to install for: the one named, which must be there; with all, each that is.
	const agents = choice.agents.filter(id => front.agent_installed(id));
	if (agents.length === 0) {
		if (choice.all) {
			const names = and_list(AGENT_IDS.map(id => AGENTS[id].name)).replace(" and ", " nor ");
			return refuse(`Neither ${names} is installed.`, {
				type: "tool-missing",
				text: [`Neither ${names} is installed.`, ...AGENT_IDS.map(id => `Install ${AGENTS[id].name} from: ${AGENTS[id].site}`)].join("\n"),
			});
		}
		const { name: agent_name, site } = AGENTS[choice.agents[0] ?? "claude"];
		return refuse(`${agent_name} is not installed. Install it from: ${site}`, {
			type: "tool-missing",
			text: `${agent_name} is not installed.\nInstall it from: ${site}`,
		});
	}
	const there = agents.filter(id => installed(skill_directory(front.home, skill.name, id)));
	if (there.length > 0 && !force) {
		const where = choice.all ? for_agents(choice, there) : for_agents(choice);
		return refuse(`Skill ${skill.name} is already installed${where}. Use --force to overwrite.`, {
			type: "needs-force",
			text: `Skill ${skill.name} is already installed${where}.\nUse --force to overwrite.`,
		});
	}
	if (!fs.existsSync(path.join(skill.source_dir, "SKILL.md"))) { throw new Error(`SKILL.md not found at ${skill.source_dir}`); }
	const done = agents.map(id => {
		const directory = skill_directory(front.home, skill.name, id);
		// Files of the user's next to the skill's are kept (SKILL-003).
		fs.mkdirSync(directory, { recursive: true });
		fs.cpSync(skill.source_dir, directory, { recursive: true, force: true });
		return { agent: id, path: directory };
	});
	const helped = done.length === 1 ? `${AGENTS[agents[0] ?? "claude"].name} now helps` : "They now help";
	const skipped = choice.agents.filter(id => !agents.includes(id)).map(id => `Skipped ${AGENTS[id].name}: it is not installed.\n`).join("");
	return done_answer(
		choice, done,
		`Installed skill ${skill.name} to ${done.map(entry => entry.path).join(", ")}`,
		`\nSkill ${skill.name} installed successfully${for_agents(choice, agents)}!\n\n${helped} with ${skill.about}.\n${skipped}`,
	);
}

export function uninstall_skill(front: FrontEnd, name: string | undefined, agent?: string): Outcome<SkillResponse | SkillAgentsResponse | SkillListResponse> {
	const choice = agent_choice(agent);
	if ("kind" in choice) { return choice; }
	if (name === undefined) { return list_skills(front, "uninstall", choice); }
	const skill = find_skill(front, name);
	if ("kind" in skill) { return skill; }
	const there = choice.agents.filter(id => installed(skill_directory(front.home, skill.name, id)));
	if (there.length === 0) {
		return refuse(`Skill ${skill.name} is not installed${choice.all ? " for any agent" : for_agents(choice)}.`, { type: "not-found" });
	}
	const done = there.map(id => {
		const directory = skill_directory(front.home, skill.name, id);
		fs.rmSync(directory, { recursive: true });
		return { agent: id, path: directory };
	});
	return done_answer(
		choice, done,
		`Removed skill ${skill.name} from ${done.map(entry => entry.path).join(", ")}`,
		`\nSkill ${skill.name} uninstalled successfully${for_agents(choice, there)}.\n`,
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
	const agents = AGENT_IDS.map(id => `${AGENTS[id].name} (${id}, ~/${AGENTS[id].directory.join("/")}/<name>/)`).join(", ");
	const agent_flag = { agent: { kind: "value", brief: `The agent: ${AGENT_IDS.join(", ")} or ${ALL} (default: claude)`, placeholder: "agent" } } as const;
	const complete = (index: number): Promise<Completion | undefined> =>
		Promise.resolve(index === 0 ? { candidates: skills.map(skill => ({ value: skill.name, description: skill.about })) } : undefined);
	const complete_flag = (flag: string): Promise<Completion | undefined> =>
		Promise.resolve(flag === "agent"
			? { candidates: [...AGENT_IDS.map(id => ({ value: id, description: AGENTS[id].name })), { value: ALL, description: "Each agent that is installed" }] }
			: undefined);
	return [
		{
			path: ["skill", "install"],
			brief: "Install a skill of the backend for an AI agent",
			full: `Install a skill of the backend for an AI agent: ${agents}. Without --agent, for Claude Code; with --agent all, for each of them that is installed. With no name, list the backend's skills and whether each is installed.${listed}${examples("install")}\n  $ ${front.program} skill install ${example} --force\n  $ ${front.program} skill install ${example} --agent codex\n  $ ${front.program} skill install`,
			group: "tooling",
			positionals: [name_positional],
			flags: { force: { kind: "boolean", brief: "Install over an installed copy" }, ...agent_flag },
			asks: false,
			supported: true,
			run: input => Promise.resolve(install_skill(front, name_of(input.positionals["name"]), input.flags["force"] === true, name_of(input.flags["agent"]))),
			complete,
			complete_flag,
		},
		{
			path: ["skill", "uninstall"],
			brief: "Remove an installed skill of an AI agent",
			full: `Remove a skill of the backend from an AI agent's skills: ${agents}. Without --agent, Claude Code's; with --agent all, each agent's that has it. With no name, list the backend's skills and whether each is installed.${listed}${examples("uninstall")}\n  $ ${front.program} skill uninstall`,
			group: "tooling",
			positionals: [name_positional],
			flags: { ...agent_flag },
			asks: false,
			supported: true,
			run: input => Promise.resolve(uninstall_skill(front, name_of(input.positionals["name"]), name_of(input.flags["agent"]))),
			complete,
			complete_flag,
		},
	];
}

if (import.meta.vitest) {
	const { describe, expect, test } = import.meta.vitest;
	const os = await import("node:os");

	/** `files` (path: contents) written under a new temporary directory, given to `check`. */
	const with_files = (files: Record<string, string>, check: (base: string) => void): void => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "aa-skill-"));
		try {
			for (const [file, contents] of Object.entries(files)) {
				fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
				fs.writeFileSync(path.join(base, file), contents);
			}
			check(base);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	};

	describe("packaged_skill", () => {
		test("from the repository, the root's skills/<folder>/, not the build's copy", () => {
			with_files({ "skills/analog-attach-linux/SKILL.md": "# Linux\n", "packages/cli/skills/analog-attach-linux/SKILL.md": "# Copy\n" }, base => {
				expect(packaged_skill(path.join(base, "packages", "cli"), "analog-attach-linux")).toBe(path.join(base, "skills", "analog-attach-linux"));
			});
		});

		test("from an installed package, its own skills/<folder>/", () => {
			with_files({ "node_modules/@analog-attach/cli/skills/analog-attach-noos/SKILL.md": "# noos\n" }, base => {
				const root = path.join(base, "node_modules", "@analog-attach", "cli");
				expect(packaged_skill(root, "analog-attach-noos")).toBe(path.join(root, "skills", "analog-attach-noos"));
			});
		});
	});
}
