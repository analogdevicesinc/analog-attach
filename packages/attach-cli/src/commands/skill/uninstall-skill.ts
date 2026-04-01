import { buildCommand } from "@stricli/core";
import { isSkillInstalled, uninstallSkill } from "./utilities";

export const uninstall_skill_command = buildCommand({
    parameters: {
        flags: {}
    },
    docs: {
        brief: "Uninstall the Attach skill from Claude Code"
    },
    async func() {
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
    }
});
