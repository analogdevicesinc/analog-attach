import { Command } from "commander";
import * as fs from "node:fs";
import { execSync } from "node:child_process";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { respond, respond_fail, input_error } from "../../protocol/output";
import type { DeployResponse } from "../../protocol/types";

/** Remote directory device tree overlays are copied to. */
const REMOTE_OVERLAY_DIR = "/boot/overlays";

/** Non-interactive ssh/scp options so the first connection does not prompt and hang. */
const SSH_OPTS = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null";

/** Build the scp command that copies the compiled overlay to the remote overlay directory. */
export function build_scp_command(dtbo: string, user: string, ip: string): string {
    return `sshpass -e scp ${SSH_OPTS} "${dtbo}" ${user}@${ip}:${REMOTE_OVERLAY_DIR}/`;
}

/** Build the ssh command that reboots the remote device. */
export function build_reboot_command(user: string, ip: string): string {
    return `sshpass -e ssh ${SSH_OPTS} ${user}@${ip} sudo reboot`;
}

/** Whether the given tool is available on PATH. */
function is_tool_available(check: string): boolean {
    try {
        execSync(check, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

export function build_deploy_command(context_: LocalContext): Command {
    return new Command("deploy")
        .description("Copy the compiled DTBO to a remote device and reboot it")
        .option("--dtbo <value>", "Path to the compiled DTBO to deploy")
        .option("--ip <value>", "IP address or hostname of the remote device")
        .option("--user <value>", "SSH username on the remote device")
        .option("--password <value>", "SSH password on the remote device")
        .action(async (options) => {
            const config = load_config();
            const dtbo = options.dtbo ?? config.overlayCompiled;
            const ip = options.ip ?? config.deployIp;
            const user = options.user ?? config.deployUser;
            const password = options.password ?? config.deployPassword;

            const missing: string[] = [];
            if (dtbo === undefined) { missing.push("overlay-compiled"); }
            if (ip === undefined) { missing.push("deploy-ip"); }
            if (user === undefined) { missing.push("deploy-user"); }
            if (password === undefined) { missing.push("deploy-password"); }

            if (missing.length > 0) {
                const message = `Missing: ${missing.join(", ")} (not configured)`;
                if (context_.json) { input_error(message); return; }
                console.log(message);
                return;
            }

            if (!fs.existsSync(dtbo)) {
                if (context_.json) { input_error(`Missing: ${dtbo}`); return; }
                console.log(`Missing: ${dtbo}`);
                return;
            }

            if (!is_tool_available("sshpass -V")) {
                if (context_.json) { input_error("sshpass not found on PATH"); return; }
                console.log("sshpass not found on PATH");
                return;
            }

            const env = { ...process.env, SSHPASS: password };

            try {
                execSync(build_scp_command(dtbo, user, ip), { stdio: "pipe", env });
            } catch (error: any) {
                const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
                if (context_.json) { respond_fail({ ok: false, message: `scp failed: ${stderr}`, severity: "error" }); return; }
                console.log(`Deploy failed (scp):\n${stderr}`);
                return;
            }

            // The reboot drops the ssh connection, so a non-zero exit here is expected — the copy
            // already succeeded with these credentials, so we treat the reboot as best-effort.
            try {
                execSync(build_reboot_command(user, ip), { stdio: "pipe", env });
            } catch {
                // connection closed by reboot — ignore
            }

            if (context_.json) {
                respond({ ok: true, message: "Deployed and rebooted", severity: "info", host: ip, remote_path: `${REMOTE_OVERLAY_DIR}/` } satisfies DeployResponse);
            } else {
                console.log(`Deployed ${dtbo} to ${user}@${ip}:${REMOTE_OVERLAY_DIR}/ and rebooted`);
            }
        });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("build_scp_command - copies dtbo to the remote overlay dir", () => {
        expect(build_scp_command("/x/overlay.dtbo", "pi", "10.0.0.5"))
            .toBe('sshpass -e scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "/x/overlay.dtbo" pi@10.0.0.5:/boot/overlays/');
    });

    test("build_reboot_command - reboots the remote device", () => {
        expect(build_reboot_command("pi", "10.0.0.5"))
            .toBe("sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null pi@10.0.0.5 sudo reboot");
    });
}
