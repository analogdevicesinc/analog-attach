import { buildCommand } from "@stricli/core";
import { isClaudeInstalled, isSkillInstalled, installSkill } from "./utilities";

export const install_skill_command = buildCommand({
    parameters: {
        flags: {
            force: {
                kind: "boolean",
                brief: "Overwrite existing skill installation",
                optional: true,
            }
        }
    },
    docs: {
        brief: "Install the Attach skill for Claude Code"
    },
    async func(flags: { force?: boolean }) {
        if (!isClaudeInstalled()) {
            console.log('Claude Code is not installed.');
            console.log('Install it from: https://claude.ai/code');
            return;
        }

        if (isSkillInstalled() && !flags.force) {
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
    }
});
