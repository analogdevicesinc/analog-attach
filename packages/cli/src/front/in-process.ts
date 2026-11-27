// The GUI's runs in the GUI's own process (`analog-attach gui`): each action of the page is one
// `main` with the words it sends, the project folder as the cwd, and stdout and stderr captured,
// instead of a new `analog-attach` process. A run pays no Node start and no module load, and what
// a backend keeps for the process (the compat index, the parsed bindings, capi-lib's registry) is
// there for the next.
//
// The runs of a noos project go one at a time: capi-lib reads its settings through module state
// (`use_settings`), so two at once would read each other's. The others overlap: the page sends
// `validate` with its reads, and the reads shouldn't wait for dt-validate. Nothing asks: there
// is no terminal.
//
// A run may be given variables on top of the process's environment (`environment`): the value of
// a secret `deploy` needs (spec deploy.md DEPLOY-040), which the page asks for and the server
// hands over without writing it anywhere. They are that run's alone: `process.env` isn't changed,
// so the runs that overlap don't see them.

import os from "node:os";
import { main } from "./main";
import { capture_stream } from "./output";
import { BACKENDS, UNLISTED } from "./registry";
import { BACKEND_KEY, backend_setting, open_settings, settings_files, type SettingsLocation } from "./settings-store";
import { agent_on_path } from "./skill";

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** The backends whose runs go one at a time. */
const ONE_AT_A_TIME = new Set(["noos"]);

/** The backend `location`'s settings name, unchecked, as `main` reads it first. */
function backend_of(location: SettingsLocation): string | undefined {
	const ids = Object.keys(BACKENDS);
	return open_settings({ files: settings_files(location), top: [{ ...backend_setting(ids), options: undefined }], sections: ids }).get(BACKEND_KEY);
}

/**
 * `run(words, cwd, environment?)`: one `analog-attach <words>` in `cwd` (for a noos project, after
 * the runs before it), with `environment` over the process's for that run only.
 */
export function in_process_runner(package_root: string): (words: readonly string[], cwd: string, environment?: Readonly<Record<string, string>>) => Promise<RunResult> {
	let queue: Promise<unknown> = Promise.resolve();
	return (words, cwd, environment) => {
		const location: SettingsLocation = { cwd, home: os.homedir(), xdg_config_home: process.env["XDG_CONFIG_HOME"] };
		const once = async (): Promise<RunResult> => {
			const stdout = capture_stream(false);
			const stderr = capture_stream(false);
			const code = await main(words, {
				registry: BACKENDS,
				unlisted: UNLISTED,
				streams: { stdout, stderr },
				location,
				tty: { stdin: false, stdout: false },
				environment: environment === undefined ? process.env : { ...process.env, ...environment },
				agent_installed: agent_on_path,
				package_root,
				long_lived: true,
			});
			return { code, stdout: stdout.text, stderr: stderr.text };
		};
		const id = backend_of(location);
		if (id === undefined || !ONE_AT_A_TIME.has(id)) { return once(); }
		const run = queue.then(once);
		queue = run.catch(() => { /* the next run goes on */ });
		return run;
	};
}
