import { Command } from "commander";
import { isClaudeInstalled, isSkillInstalled, installSkill } from "./utilities";
import type { LocalContext } from "../../context";

export function build_install_skill_command(_context: LocalContext): Command {
    return new Command("install-skill")
        .description("Install the Attach skill for Claude Code")
        .option("--force", "Overwrite existing skill installation")
        .action(async (options) => {
            if (!isClaudeInstalled()) {
                console.log('Claude Code is not installed.');
                console.log('Install it from: https://claude.ai/code');
                return;
            }

            if (isSkillInstalled() && !options.force) {
                console.log('Attach skill is already installed.');
                console.log('Use --force to overwrite.');
                return;
            }

            const result = installSkill();

            if (result.success) {
                console.log('');
                console.log('Attach skill installed successfully!');
                console.log('');
                console.log('Claude Code will now assist with device tree configuration.');
                console.log('Try asking: "help me configure an ADC for my Raspberry Pi"');
                console.log('');
            } else {
                throw new Error(`Failed to install skill: ${result.message}`);
            }
        });
}
