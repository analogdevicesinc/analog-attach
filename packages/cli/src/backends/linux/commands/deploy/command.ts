import { execSync } from "node:child_process";

import { answer, command, refuse, type Outcome, type Session } from "../../../../interface/backend-interface";
import { project_root, run_shell } from "../../../shell";
import { read_settings } from "../../config/settings";
import { derive_dtbo_path, load_workspace } from "../../config/workspace";
import { substitute_command } from "../../utilities";
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

/** `deploy-command` in place of scp and the reboot: run at the base of the project, its output on stderr. */
async function run_deploy_command(template: string, session: Session): Promise<Outcome<DeployResponse>> {
    const loaded = load_workspace(session, ["overlay_path"]);
    if (!loaded.ok) { return loaded.outcome; }
    const dtbo = derive_dtbo_path(loaded.workspace.overlay_path, loaded.workspace.settings.build_dir);
    const progress = session.progress(`Deploying ${dtbo} with '${template}'`);
    const result = await run_shell(substitute_command(template, { dtbo }), project_root(session), { line: text => { progress.line(text); }, signal: session.signal });
    progress.done();
    if (result.exit_code !== 0) {
        return refuse(`Deploy failed with exit code ${String(result.exit_code)}`);
    }
    return answer<DeployResponse>({ ok: true, message: `Deployed ${dtbo} with '${template}'`, severity: "info" }, "Deploy completed successfully");
}

export const deploy = command<Record<never, never>, DeployResponse>({
    docs: {
        brief: "Deploy the compiled overlay to a remote device",
        full: `Copies the .dtbo that 'build' compiled to /boot/overlays/ on the remote device
via scp, then reboots it. Requires scp and sshpass on PATH.

Required settings (set with config <key> <value>):
  deploy-ip           IP address or hostname of the device
  deploy-user         SSH username
  deploy-password     SSH password

With deploy-command set, runs that instead, at the base of the project, with
{dtbo} the .dtbo's path.`,
        examples: ["config deploy-ip 192.168.1.42", "deploy", "--json deploy", "config deploy-command 'cp {dtbo} /mnt/boot/overlays/'"],
    },
    run(_arguments, _flags, session) {
        const template = read_settings(session.settings).deploy_command;
        if (template !== undefined && template !== "") { return run_deploy_command(template, session); }
        const loaded = load_workspace(session, ["deploy"]);
        if (!loaded.ok) { return Promise.resolve(loaded.outcome); }
        const { dtbo, host: ip, user, password } = loaded.workspace.deploy;
        const environment = { ...process.env, SSHPASS: password };

        try {
            execSync(build_scp_command(dtbo, user, ip), { stdio: "pipe", env: environment });
        } catch (error: any) {
            const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
            return Promise.resolve(refuse(`Deploy failed (scp):\n${stderr}`));
        }

        // The reboot drops the ssh connection, so a non-zero exit here is expected — the copy
        // already succeeded with these credentials, so we treat the reboot as best-effort.
        try {
            execSync(build_reboot_command(user, ip), { stdio: "pipe", env: environment });
        } catch {
            // connection closed by reboot — ignore
        }

        return Promise.resolve(answer(
            { ok: true, message: "Deployed and rebooted", severity: "info", host: ip, remote_path: `${REMOTE_OVERLAY_DIR}/` } satisfies DeployResponse,
            `Deployed ${dtbo} to ${user}@${ip}:${REMOTE_OVERLAY_DIR}/ and rebooted`,
        ));
    },
});

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
