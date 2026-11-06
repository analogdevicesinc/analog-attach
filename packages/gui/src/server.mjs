#!/usr/bin/env node
// The GUI's server: it serves index.html and runs the CLI for the page. Every action in the
// page is one `analog-attach <args>` run in the project folder. Arguments are passed as an
// array to spawn (no shell), and the server only listens on 127.0.0.1.
//
// `analog-attach gui` starts it (packages/cli, src/front/gui.ts). On its own, for working on the
// page:
//
//   node src/server.mjs [project folder] [--port 5177]
//
// runs the `analog-attach` on PATH, or the command in $ANALOG_ATTACH (`node path/to/cli.js`).

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORT = 5177;
const INDEX_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html");

function read_body(request) {
	return new Promise((resolve, reject) => {
		let body = "";
		request.on("data", chunk => { body += chunk; });
		request.on("end", () => {
			try {
				resolve(body === "" ? {} : JSON.parse(body));
			} catch (error) {
				reject(error);
			}
		});
		request.on("error", reject);
	});
}

function valid_args(args) {
	return Array.isArray(args) && args.every(arg => typeof arg === "string");
}

function send(response, status, body, type = "application/json") {
	response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
	response.end(type === "application/json" ? JSON.stringify(body) : body);
}

/**
 * Start the GUI's server. `cli` is the command that runs the CLI, as an array (`[node,
 * "/path/to/cli.js"]`); `project` the folder the CLI runs in, which the page can change.
 * Resolves with the server and its URL once it listens.
 */
export function start_gui({ cli, project, port = DEFAULT_PORT, html = INDEX_HTML }) {
	let folder = path.resolve(project);
	const [command, ...prefix] = cli;

	/** Run the CLI to completion: exit code, stdout, stderr, and stdout parsed when it is JSON. */
	const run = args => new Promise(resolve => {
		const child = spawn(command, [...prefix, ...args], { cwd: folder, env: { ...process.env, NO_COLOR: "1" } });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", chunk => { stdout += chunk; });
		child.stderr.on("data", chunk => { stderr += chunk; });
		child.on("error", error => resolve({ code: -1, stdout, stderr: String(error) }));
		child.on("close", code => {
			let json;
			try {
				json = JSON.parse(stdout);
			} catch {
				json = undefined;
			}
			resolve({ code, stdout, stderr, json });
		});
	});

	/** The project folder, whether it has project settings, and its backend. */
	const describe = async () => {
		const backend = await run(["--json", "config", "backend"]);
		return {
			dir: folder,
			settings: fs.existsSync(path.join(folder, ".analog-attach", "config.json")),
			backend: backend.json?.configs?.[0]?.value ?? null,
		};
	};

	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		try {
			if (request.method === "GET" && url.pathname === "/") {
				send(response, 200, fs.readFileSync(html, "utf8"), "text/html; charset=utf-8");
				return;
			}

			if (url.pathname === "/api/project") {
				if (request.method === "POST") {
					const { dir, create } = await read_body(request);
					const resolved = path.resolve(String(dir ?? "").replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
					// A new project's folder (the setup's "New project"): made when asked for.
					if (create === true && !fs.existsSync(resolved)) {
						fs.mkdirSync(resolved, { recursive: true });
					}
					if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
						send(response, 400, { error: `Not a folder: ${resolved}` });
						return;
					}
					folder = resolved;
				}
				send(response, 200, await describe());
				return;
			}

			if (request.method === "POST" && url.pathname === "/api/run") {
				const { args } = await read_body(request);
				if (!valid_args(args)) {
					send(response, 400, { error: "args must be an array of strings" });
					return;
				}
				send(response, 200, await run(args));
				return;
			}

			// Long commands (build, deploy): the output as it comes, then a last line with the exit code.
			if (request.method === "POST" && url.pathname === "/api/stream") {
				const { args } = await read_body(request);
				if (!valid_args(args)) {
					send(response, 400, { error: "args must be an array of strings" });
					return;
				}
				response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
				const child = spawn(command, [...prefix, ...args], { cwd: folder, env: { ...process.env, NO_COLOR: "1" } });
				child.stdout.on("data", chunk => response.write(chunk));
				child.stderr.on("data", chunk => response.write(chunk));
				child.on("error", error => response.end(`\n${String(error)}\n\u0000exit -1`));
				child.on("close", code => response.end(`\n\u0000exit ${String(code)}`));
				request.on("close", () => { if (child.exitCode === null) child.kill(); });
				return;
			}

			send(response, 404, { error: "not found" });
		} catch (error) {
			send(response, 500, { error: String(error) });
		}
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			const address = server.address();
			resolve({ server, url: `http://127.0.0.1:${String(typeof address === "object" && address ? address.port : port)}` });
		});
	});
}

// Run on its own: `node src/server.mjs [project folder] [--port <n>]`.
if (process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const argv = process.argv.slice(2);
	const port_flag = argv.indexOf("--port");
	const port = port_flag >= 0 ? Number(argv[port_flag + 1]) : DEFAULT_PORT;
	const positional = argv.filter((arg, index) => !arg.startsWith("--") && argv[index - 1] !== "--port");
	const cli = (process.env.ANALOG_ATTACH ?? "analog-attach").split(" ").filter(word => word !== "");
	const { url } = await start_gui({ cli, project: positional[0] ?? process.cwd(), port });
	console.log(`analog-attach GUI on ${url}  (project: ${path.resolve(positional[0] ?? process.cwd())})`);
}
