// The long-lived dt-validate (scripts/dt-validate-worker.py, spec VALIDATE-015) that
// `validate` asks instead of starting dt-validate, when the GUI runs it: in the GUI's own process
// (`Session.long_lived`), whose pid is the owner, or as a child of the GUI's server, which puts
// its pid in ANALOG_ATTACH_VALIDATE_WORKER (GUI-010). The worker lives as long as the owner (or
// until it is idle). Python, dtschema and the schema load once, so a check takes about 65 ms instead of 175.
//
// The first run finds no worker: it starts one and uses dt-validate itself. Any trouble with
// the worker (gone, an error, too slow) is the same: dt-validate answers. A check that takes
// more than CHECK_SECONDS ends the worker, so the next run starts another. The socket is in a
// directory only the user reaches (private_directory); where there is none, as on Windows,
// dt-validate answers every run.

import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import path from "node:path";
import type { ValidateWorker } from "../../config/tools";

export const WORKER_OWNER_VARIABLE = "ANALOG_ATTACH_VALIDATE_WORKER";
/** How long a worker waits for a request before it leaves. */
const IDLE_SECONDS = 15 * 60;
/** How long the worker gives a check (about 65 ms) before it leaves. */
const CHECK_SECONDS = 10;
/** How long a run waits for the worker before dt-validate is asked instead. */
const TIMEOUT_MS = (CHECK_SECONDS + 5) * 1000;

export interface WorkerRequest {
	schema: string;
	dtb: string;
	json_output: string;
	/** Where dt-validate would run (`session.cwd`). Default: the process's. */
	cwd?: string;
}

/** The owner's pid from the environment: set only by the GUI's server. */
export function worker_owner(environment: NodeJS.ProcessEnv = process.env): number | undefined {
	const owner = Number(environment[WORKER_OWNER_VARIABLE]);
	return Number.isInteger(owner) && owner > 0 ? owner : undefined;
}

/**
 * The socket's directory, `analog-attach-<uid>` under $XDG_RUNTIME_DIR or the temp directory:
 * made 0700, and taken only when it is this user's own directory and nobody else's to enter, since
 * a request makes the worker write a file as the user. None on Windows.
 */
export function private_directory(base: string = runtime_directory()): string | undefined {
	const uid = process.getuid === undefined ? undefined : process.getuid();
	if (uid === undefined || process.platform === "win32" || !path.isAbsolute(base)) { return undefined; }
	const directory = path.join(base, `analog-attach-${uid}`);
	try {
		fs.mkdirSync(directory, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") { return undefined; }
	}
	try {
		const stat = fs.lstatSync(directory);
		return stat.isDirectory() && stat.uid === uid && (stat.mode & 0o077) === 0 ? directory : undefined;
	} catch {
		return undefined;
	}
}

function runtime_directory(): string {
	const runtime = process.env["XDG_RUNTIME_DIR"];
	return runtime === undefined || runtime === "" ? os.tmpdir() : runtime;
}

/**
 * The worker's socket: one per owner, project and worker, in the private directory (a short
 * name: a Unix socket's path is at most 104 bytes on macOS, 108 on Linux).
 */
export function worker_socket(owner: number, state_directory: string, worker: ValidateWorker, base?: string): string | undefined {
	const directory = private_directory(base);
	if (directory === undefined) { return undefined; }
	const hash = crypto.createHash("sha256").update(JSON.stringify([owner, state_directory, worker.key])).digest("hex").slice(0, 16);
	return path.join(directory, `validate-${hash}.sock`);
}

/**
 * dt-validate's `request` through the worker: true once it wrote `json_output`, false when it
 * didn't (no worker yet, which this starts; it failed; no private directory), so dt-validate
 * runs instead. `base` is the private directory's parent, for the tests.
 */
export async function validate_with_worker(worker: ValidateWorker, owner: number, state_directory: string, request: WorkerRequest, base?: string): Promise<boolean> {
	const socket = worker_socket(owner, state_directory, worker, base);
	if (socket === undefined) { return false; }
	const answer = await ask(socket, { cwd: process.cwd(), ...request });
	if (answer === "unreachable") {
		start_worker(worker, socket, owner);
		return false;
	}
	return answer;
}

function ask(socket: string, request: WorkerRequest & { cwd: string }): Promise<boolean | "unreachable"> {
	return new Promise(resolve => {
		let reply = "";
		let connected = false;
		const connection = net.createConnection(socket);
		const done = (result: boolean | "unreachable"): void => {
			connection.destroy();
			resolve(result);
		};
		connection.setTimeout(TIMEOUT_MS, () => { done(false); });
		connection.on("connect", () => {
			connected = true;
			connection.write(`${JSON.stringify(request)}\n`);
		});
		connection.on("data", chunk => {
			reply += chunk.toString();
			if (!reply.includes("\n")) { return; }
			try {
				done((JSON.parse(reply) as { ok?: unknown }).ok === true);
			} catch {
				done(false);
			}
		});
		connection.on("error", () => { done(connected ? false : "unreachable"); });
		connection.on("end", () => { done(false); });
	});
}

/** The worker, detached: it outlives this run, and the next one asks it. */
function start_worker(worker: ValidateWorker, socket: string, owner: number): void {
	try {
		const child = spawn(worker.python, ["-E", worker.script, socket, String(owner), String(IDLE_SECONDS), String(CHECK_SECONDS)], { detached: true, stdio: "ignore" });
		child.on("error", () => { /* no worker: dt-validate keeps answering */ });
		child.unref();
	} catch {
		// No worker: dt-validate keeps answering.
	}
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	const worker = (directory: string): ValidateWorker => {
		// A stand-in Python: it writes the arguments it was started with, so a test sees the worker started.
		const python = path.join(directory, "python");
		fs.writeFileSync(python, `#!/bin/sh\nprintf '%s\\n' "$*" > "${path.join(directory, "started")}"\n`, { mode: 0o755 });
		return { python, script: "/assets/dt-validate-worker.py", key: "k" };
	};
	const temporary = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "attach-worker-"));
	const uid = process.getuid === undefined ? 0 : process.getuid();

	test("worker_owner - a pid from the environment, else none", () => {
		expect(worker_owner({ [WORKER_OWNER_VARIABLE]: "4242" })).toBe(4242);
		for (const value of [undefined, "", "0", "-3", "x", "1.5"]) { expect(worker_owner({ [WORKER_OWNER_VARIABLE]: value })).toBeUndefined(); }
	});

	test.skipIf(process.platform === "win32")("private_directory - made 0700, and refused when another can enter it or it is a link", () => {
		const base = temporary();
		try {
			const directory = path.join(base, `analog-attach-${uid}`);
			expect(private_directory(base)).toBe(directory);
			expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
			expect(private_directory(base)).toBe(directory);
			fs.chmodSync(directory, 0o755);
			expect(private_directory(base)).toBeUndefined();
			fs.rmSync(directory, { recursive: true });
			fs.mkdirSync(path.join(base, "elsewhere"), { mode: 0o700 });
			fs.symlinkSync(path.join(base, "elsewhere"), directory);
			expect(private_directory(base)).toBeUndefined();
			expect(private_directory("relative")).toBeUndefined();
		} finally {
			fs.rmSync(base, { recursive: true });
		}
	});

	test.skipIf(process.platform === "win32")("worker_socket - one per owner, project and worker, in the private directory", () => {
		const base = temporary();
		try {
			const given: ValidateWorker = { python: "p", script: "s", key: "k" };
			const one = worker_socket(1, "/project/.analog-attach/linux", given, base);
			expect(one).toBe(worker_socket(1, "/project/.analog-attach/linux", given, base));
			expect(new Set([one, worker_socket(2, "/project/.analog-attach/linux", given, base), worker_socket(1, "/other", given, base), worker_socket(1, "/project/.analog-attach/linux", { ...given, key: "k2" }, base)]).size).toBe(4);
			expect(one).toMatch(new RegExp(String.raw`/analog-attach-${uid}/validate-[0-9a-f]{16}\.sock$`));
			expect(path.dirname(one ?? "")).toBe(path.join(base, `analog-attach-${uid}`));
			fs.chmodSync(path.join(base, `analog-attach-${uid}`), 0o777);
			expect(worker_socket(1, "/project/.analog-attach/linux", given, base)).toBeUndefined();
		} finally {
			fs.rmSync(base, { recursive: true });
		}
	});

	test.skipIf(process.platform === "win32")("validate_with_worker - no worker: false, and one is started for the next run", async () => {
		const directory = temporary();
		try {
			const given = worker(directory);
			expect(await validate_with_worker(given, 4242, directory, { schema: "s.json", dtb: "t.dtb", json_output: "e.json" }, directory)).toBe(false);
			const started = path.join(directory, "started");
			for (let wait = 0; wait < 100 && !fs.existsSync(started); wait++) { await new Promise(resolve => setTimeout(resolve, 20)); }
			expect(fs.readFileSync(started, "utf8").trim()).toBe(`-E /assets/dt-validate-worker.py ${worker_socket(4242, directory, given, directory) ?? ""} 4242 ${IDLE_SECONDS} ${CHECK_SECONDS}`);
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test.skipIf(process.platform === "win32")("validate_with_worker - no private directory: false, and no worker is started", async () => {
		const directory = temporary();
		try {
			const given = worker(directory);
			fs.mkdirSync(path.join(directory, `analog-attach-${uid}`), { mode: 0o755 });
			fs.chmodSync(path.join(directory, `analog-attach-${uid}`), 0o755);
			expect(await validate_with_worker(given, 4242, directory, { schema: "s.json", dtb: "t.dtb", json_output: "e.json" }, directory)).toBe(false);
			await new Promise(resolve => setTimeout(resolve, 200));
			expect(fs.existsSync(path.join(directory, "started"))).toBe(false);
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test.skipIf(process.platform === "win32")("validate_with_worker - a worker's answer: true when it wrote the file, false when it failed", async () => {
		const directory = temporary();
		const given = worker(directory);
		const requests: unknown[] = [];
		let ok = true;
		const server = net.createServer(connection => {
			connection.on("data", chunk => {
				requests.push(JSON.parse(chunk.toString()));
				connection.end(`${JSON.stringify(ok ? { ok: true } : { ok: false, error: "boom" })}\n`);
			});
		});
		const socket = worker_socket(4242, directory, given, directory) ?? "";
		await new Promise<void>(resolve => { server.listen(socket, resolve); });
		try {
			const request = { schema: "s.json", dtb: "t.dtb", json_output: "e.json" };
			expect(await validate_with_worker(given, 4242, directory, request, directory)).toBe(true);
			expect(requests).toEqual([{ cwd: process.cwd(), ...request }]);
			ok = false;
			expect(await validate_with_worker(given, 4242, directory, request, directory)).toBe(false);
			expect(fs.existsSync(path.join(directory, "started"))).toBe(false);
		} finally {
			await new Promise(resolve => { server.close(resolve); });
			fs.rmSync(directory, { recursive: true });
		}
	});
}
