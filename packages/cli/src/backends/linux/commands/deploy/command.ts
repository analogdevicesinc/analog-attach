import { answer, cancelled, command, PromptCancelled, refuse, type Outcome, type Session } from "../../../../interface/backend-interface";
import { EXECUTABLE_NAMES } from "../../config/settings";
import { derive_build_files, load_workspace } from "../../config/workspace";
import {
	missing_secret, run_script, script_environment, script_failure, secret_from, secrets_of, session_sources, system_variables,
} from "../../scripts";
import type { DeployResponse } from "../../protocol/types";

/**
 * `deploy`: run `AA_DEPLOY` in the project root, `./aa_deploy.sh` unless the project changed it
 * (DEPLOY-030), with the project's variables and
 * its secrets. A secret's value is the environment's (DEPLOY-040); on a terminal a missing one
 * is asked for, hidden, once the rest has loaded (DEPLOY-041); otherwise it is a problem like
 * any other of the configuration (DEPLOY-042).
 */
async function run_deploy(session: Session): Promise<Outcome<DeployResponse>> {
	const variables = session.settings.variables();
	const secrets: Record<string, string> = {};
	const missing: string[] = [];
	for (const name of secrets_of(variables)) {
		const value = secret_from(session.environment, name);
		if (value === undefined) { missing.push(name); } else { secrets[name] = value; }
	}
	const password = session.prompter?.password;
	const unasked = password === undefined ? missing.map(name => missing_secret(name, session.program)) : [];
	const loaded = load_workspace(session, ["overlay_path", "deploy_script"], unasked);
	if (!loaded.ok) { return loaded.outcome; }
	const { overlay_path: workfile, deploy_script: script, settings } = loaded.workspace;

	if (password !== undefined) {
		try {
			for (const name of missing) {
				secrets[name] = await password({ message: `${name}:`, validate: answer_text => answer_text === "" ? `${name} can't be empty` : true });
			}
		} catch (error) {
			if (error instanceof PromptCancelled) { return cancelled("Stopped: nothing was deployed."); }
			throw error;
		}
	}

	const environment = script_environment("deploy", session.environment, system_variables(session_sources(session)), variables, secrets);
	const { binary } = derive_build_files(workfile, settings.output, settings.build_dir);
	const result = await run_script(session, script, `Deploying ${binary} with ${EXECUTABLE_NAMES.deploy}`, environment);
	if (result.exit_code !== 0 || result.error !== undefined) {
		const message = script_failure("deploy", result);
		return refuse(result.stderr === "" ? message : `${message}\n${result.stderr}`, { type: "tool-failed", text: message });
	}
	return answer<DeployResponse>({ ok: true, message: `Deployed ${binary} with ${EXECUTABLE_NAMES.deploy}`, severity: "info" }, "Deploy completed successfully");
}

export const deploy = command<Record<never, never>, DeployResponse>({
	docs: {
		brief: "Run AA_DEPLOY (aa_deploy.sh): copy the compiled overlay to the board and reboot it",
		full: `Runs the AA_DEPLOY variable's command with sh at the base of the project (the
folder that holds .analog-attach/), its output shown as it comes. It is ./aa_deploy.sh
unless the project changes it ('analog-attach config var AA_DEPLOY <command>';
--reset goes back). 'analog-attach init' writes a starter aa_deploy.sh for a
Raspberry Pi running Kuiper: it checks the board answers, copies the .dtbo that
'build' compiled into the boot folder's overlays/, adds dtoverlay=<name> to
config.txt when it isn't there, and reboots the board. With 'config output
devicetree', it copies the .dtb over /boot/devicetree.dtb instead. Edit it as you
need; 'analog-attach init --restore deploy' writes the starter again.

The starter needs ssh, scp and sshpass, and the board in three variables:
  analog-attach config var BOARD_IP 192.168.2.10
  analog-attach config var BOARD_USER analog
  analog-attach config var BOARD_PASSWORD --secret

A secret is stored by name only. Its value comes from the environment deploy runs in
(BOARD_PASSWORD=... analog-attach deploy); on a terminal, deploy asks for a missing
one without showing it. Elsewhere (piped, --json) a missing one is refused by name.`,
		examples: ["config var BOARD_IP 192.168.2.10", "deploy", "--json deploy", "init --restore deploy"],
	},
	run: (_arguments, _flags, session) => run_deploy(session),
});
