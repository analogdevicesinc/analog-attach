import * as fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getSkillDirectory(): string {
    const homeDirectory = process.env['HOME'] || process.env['USERPROFILE'] || '';
    return path.join(homeDirectory, '.claude', 'skills', 'attach');
}

export function getSourceSkillPath(): string {
    // tsup bundles everything into dist/, so only go up one level to package root
    const packageRoot = path.resolve(__dirname, '..');
    return path.join(packageRoot, 'SKILL.md');
}

export function isClaudeInstalled(): boolean {
    try {
        execSync('claude --version', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export function isSkillInstalled(): boolean {
    const skillDirectory = getSkillDirectory();
    const skillFile = path.join(skillDirectory, 'SKILL.md');
    return fs.existsSync(skillFile);
}

export function installSkill(): { success: boolean; message: string } {
    const skillDirectory = getSkillDirectory();
    const sourceSkill = getSourceSkillPath();
    const destinationSkill = path.join(skillDirectory, 'SKILL.md');

    if (!fs.existsSync(sourceSkill)) {
        return {
            success: false,
            message: `SKILL.md not found at ${sourceSkill}`
        };
    }

    try {
        fs.mkdirSync(skillDirectory, { recursive: true });
        fs.copyFileSync(sourceSkill, destinationSkill);
        return {
            success: true,
            message: `Skill installed to ${skillDirectory}`
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to install skill: ${error}`
        };
    }
}

export function uninstallSkill(): { success: boolean; message: string } {
    const skillDirectory = getSkillDirectory();
    const skillFile = path.join(skillDirectory, 'SKILL.md');

    if (!fs.existsSync(skillFile)) {
        return {
            success: false,
            message: 'Skill is not installed'
        };
    }

    try {
        fs.rmSync(skillDirectory, { recursive: true });
        return {
            success: true,
            message: 'Skill uninstalled successfully'
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to uninstall skill: ${error}`
        };
    }
}
