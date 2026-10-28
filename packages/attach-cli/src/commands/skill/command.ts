import { Argument, Command } from "commander";

import type { LocalContext } from "../../context";
import { input_error } from "../../protocol/output";
import { installSkill, isClaudeInstalled, isSkillInstalled, uninstallSkill } from "./utilities";

function install(force: boolean): void {
    if (!isClaudeInstalled()) {
        console.log("Claude Code is not installed.");
        console.log("Install it from: https://claude.ai/code");
        return;
    }
    if (isSkillInstalled() && !force) {
        console.log("Attach skill is already installed.");
        console.log("Use --force to overwrite.");
        return;
    }
    const result = installSkill();
    if (!result.success) { throw new Error(result.message); }
    console.log("");
    console.log("Attach skill installed successfully!");
    console.log("");
    console.log("Claude Code will now assist with device tree configuration.");
    console.log("Try asking: \"help me configure an ADC for my Raspberry Pi\"");
    console.log("");
}

function uninstall(): void {
    if (!isSkillInstalled()) {
        console.log("Attach skill is not installed.");
        return;
    }
    const result = uninstallSkill();
    if (!result.success) { throw new Error(result.message); }
    console.log("");
    console.log("Attach skill uninstalled successfully.");
    console.log("");
}

export function build_skill_command(context: LocalContext): Command {
    return new Command("skill")
        .description("Install or uninstall the Attach skill for Claude Code")
        .addArgument(new Argument("<action>", "install or uninstall").choices(["install", "uninstall"]))
        .option("--force", "With install: overwrite an installed skill")
        .addHelpText("after", `
The skill goes to ~/.claude/skills/attach-linux/SKILL.md.

Examples:
  $ attach-linux skill install
  $ attach-linux skill install --force
  $ attach-linux skill uninstall`)
        .action((action: "install" | "uninstall", options: { force?: boolean }) => {
            if (action === "uninstall" && options.force === true) {
                const message = "--force applies to 'skill install' only";
                if (context.json) { input_error(message); } else { console.log(message); }
                return;
            }
            if (action === "install") { install(options.force === true); } else { uninstall(); }
        });
}
