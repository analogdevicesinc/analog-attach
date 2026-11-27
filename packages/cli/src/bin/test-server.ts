// The functional tests' fast mode (`run.sh --fast`, test/functional/README.md): one process that
// runs `main` for every call of `aa`, so a call pays no Node start, no module load and no parse
// of what a backend keeps for the process. Not shipped (package.json `files`), and not what CI
// runs: there every call is the real binary.
//
// `node dist/test-server.js <socket>` listens on that Unix socket. A call (test/functional/
// fast-client.mjs) sends `{ argv, cwd, env }` as JSON and closes its side; the answer is
// `{ code, stdout, stderr }`. Each call runs as its own process would, one at a time: the
// process's environment is the caller's, its cwd the caller's (code reads `process.env`,
// `process.cwd()` and `os.homedir()` directly), there is no terminal, and `long_lived` is false.
// What it doesn't check is the binary's own part (src/bin/cli.ts) and a cold start.

import fs from "node:fs";
import net from "node:net";
import { main } from "../front/main";
import { capture_stream, EXIT_CRASH } from "../front/output";
import { BACKENDS, UNLISTED } from "../front/registry";
import { agent_on_path } from "../front/skill";

interface Call {
	argv: string[];
	cwd: string;
	env: Record<string, string>;
}

const socket = process.argv[2];
if (socket === undefined) { throw new Error("usage: test-server.js <socket>"); }

async function run_call({ argv, cwd, env }: Call): Promise<{ code: number; stdout: string; stderr: string }> {
	for (const key of Object.keys(process.env)) { delete process.env[key]; }
	Object.assign(process.env, env);
	process.chdir(cwd);
	const stdout = capture_stream(false);
	const stderr = capture_stream(false);
	let code: number;
	try {
		code = await main(argv, {
			registry: BACKENDS,
			unlisted: UNLISTED,
			streams: { stdout, stderr },
			location: { cwd, home: env["HOME"] ?? "", xdg_config_home: env["XDG_CONFIG_HOME"] },
			tty: { stdin: false, stdout: false },
			environment: process.env,
			agent_installed: agent_on_path,
			long_lived: false,
		});
	} catch (error) {
		// What the binary would die of: its stack on stderr.
		code = EXIT_CRASH;
		stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
	}
	return { code, stdout: stdout.text, stderr: stderr.text };
}

// A rejection a call left behind would end the binary; here it must not end the next calls.
process.on("unhandledRejection", reason => { process.stderr.write(`test-server: unhandled rejection: ${String(reason)}\n`); });

let queue: Promise<unknown> = Promise.resolve();
fs.rmSync(socket, { force: true });
net.createServer({ allowHalfOpen: true }, connection => {
	let request = "";
	connection.setEncoding("utf8");
	connection.on("data", (chunk: string) => { request += chunk; });
	connection.on("end", () => {
		const call = queue.then(() => run_call(JSON.parse(request) as Call));
		queue = call.catch(() => { /* the next call goes on */ });
		call.then(
			result => { connection.end(JSON.stringify(result)); },
			(error: unknown) => { connection.end(JSON.stringify({ code: EXIT_CRASH, stdout: "", stderr: `test-server: ${String(error)}\n` })); },
		);
	});
}).listen(socket);
