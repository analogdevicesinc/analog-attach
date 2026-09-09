import { Command } from "commander";
import { isSkillInstalled, uninstallSkill } from "./utilities";
import type { LocalContext } from "../../context";

export function build_uninstall_skill_command(_ctx: LocalContext): Command {
    return new Command("uninstall-skill")
        .description("Uninstall the Attach skill from Claude Code")
        .action(async () => {
            if (!isSkillInstalled()) {
                console.log('Attach skill is not installed.');
                return;
            }

            const result = uninstallSkill();

            if (result.success) {
                console.log('');
                console.log('Attach skill uninstalled successfully.');
                console.log('');
            } else {
                throw new Error(`Failed to uninstall skill: ${result.message}`);
            }
        });
}
