#!/usr/bin/env node

import * as fs from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isClaudeInstalled() {
    try {
        execSync('claude --version', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function getSkillDirectory() {
    const homeDirectory = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(homeDirectory, '.claude', 'skills', 'attach');
}

function getSourceSkillPath() {
    // Navigate from scripts/ to package root
    const packageRoot = path.resolve(__dirname, '..');
    return path.join(packageRoot, 'SKILL.md');
}

function isSkillInstalled() {
    const skillDirectory = getSkillDirectory();
    const skillFile = path.join(skillDirectory, 'SKILL.md');
    return fs.existsSync(skillFile);
}

function installSkill() {
    const skillDirectory = getSkillDirectory();
    const sourceSkill = getSourceSkillPath();
    const destinationSkill = path.join(skillDirectory, 'SKILL.md');

    if (!fs.existsSync(sourceSkill)) {
        console.error(`SKILL.md not found at ${sourceSkill}`);
        return false;
    }

    try {
        fs.mkdirSync(skillDirectory, { recursive: true });
        fs.copyFileSync(sourceSkill, destinationSkill);
        return true;
    } catch (error) {
        console.error(`Failed to install skill: ${error}`);
        return false;
    }
}

async function prompt(question) {
    // Check if we're in an interactive terminal
    if (!process.stdin.isTTY) {
        return 'n'; // Non-interactive, skip
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim().toLowerCase());
        });
    });
}

async function main() {
    // Skip in CI environments
    if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
        return;
    }

    // Check if Claude Code is installed
    if (!isClaudeInstalled()) {
        console.log('');
        console.log('Attach CLI installed successfully.');
        console.log('');
        console.log('Claude Code not detected. To enable Claude Code integration later:');
        console.log('  1. Install Claude Code: https://claude.ai/code');
        console.log('  2. Run: attach install-skill');
        console.log('');
        return;
    }

    // Check if skill is already installed
    if (isSkillInstalled()) {
        console.log('');
        console.log('Attach CLI installed successfully.');
        console.log('Attach skill for Claude Code is already installed.');
        console.log('');
        return;
    }

    // Interactive prompt
    console.log('');
    console.log('========================================');
    console.log('  Attach CLI - Claude Code Integration');
    console.log('========================================');
    console.log('');
    console.log('Claude Code detected on your system.');
    console.log('');
    console.log('Would you like to install the Attach skill?');
    console.log('This enables Claude to help you configure Linux device tree overlays');
    console.log('for hardware devices (ADCs, DACs, sensors, etc.).');
    console.log('');

    const answer = await prompt('Install Attach skill for Claude Code? [Y/n]: ');

    if (answer === 'n' || answer === 'no') {
        console.log('');
        console.log('Skipped skill installation.');
        console.log('Run "attach install-skill" later to install.');
        console.log('');
        return;
    }

    // Install the skill
    if (installSkill()) {
        console.log('');
        console.log('Attach skill installed successfully!');
        console.log('');
        console.log('Claude Code will now assist with device tree configuration.');
        console.log('Try asking: "help me configure an ADC for my Raspberry Pi"');
        console.log('');
        console.log('To uninstall later: attach uninstall-skill');
        console.log('');
    } else {
        console.log('');
        console.log('Failed to install skill automatically.');
        console.log('Try running manually: attach install-skill');
        console.log('');
    }
}

try {
    await main();
} catch (error) {
    // Don't fail the npm install if postinstall has issues
    console.error('Postinstall warning:', error.message);
}
