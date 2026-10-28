import fs from "node:fs";
import http from "node:http";

export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

/** Runs `attach-linux <arguments> --json` and collects what it printed. */
export type Runner = (arguments_: string[]) => Promise<RunResult>;

/**
 * What the page may run, with the options each command takes. The server
 * is reachable by every page the browser opens, so anything that executes
 * configured commands (`config`, `build`, `deploy`, `import`) is left out.
 */
const COMMANDS: Record<string, readonly string[]> = {
    "read": [],
    "list": [],
    "add": ["--parent", "--name", "--label"],
    "update": [],
    "delete": ["--force"],
    "enable": [],
    "disable": [],
    "validate": [],
    "init": [],
};

/** The config fields the page may see; `config` also returns the deploy password. */
const VISIBLE_FIELDS = new Set(["linux", "devicetree", "overlay", "overlay-syntax"]);

const MAX_BODY = 64 * 1024;

export interface UiServerOptions {
    run: Runner;
    page: string;
    /** Secret the page sends with every API call. */
    token: string;
}

/** The arguments to run, or why the request is refused. */
export function check_request(body: unknown): { run: string[] } | { error: string } {
    if (typeof body !== "object" || body === null) { return { error: "expected a JSON object" }; }
    const { command, args } = body as { command?: unknown; args?: unknown };
    if (typeof command !== "string" || !Object.hasOwn(COMMANDS, command)) { return { error: `command not allowed: ${String(command)}` }; }
    if (!Array.isArray(args) || !args.every(a => typeof a === "string")) { return { error: "args must be a list of strings" }; }
    const options = COMMANDS[command] ?? [];
    for (const argument of args as string[]) {
        if (argument.startsWith("-") && !options.includes(argument)) { return { error: `option not allowed: ${argument}` }; }
    }
    return { run: [command, ...(args as string[])] };
}

function parse_json(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function read_body(request: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY) { reject(new Error("request too large")); request.destroy(); return; }
            chunks.push(chunk);
        });
        request.on("end", () => { resolve(Buffer.concat(chunks).toString("utf8")); });
        request.on("error", reject);
    });
}

export function create_ui_server(options: UiServerOptions): http.Server {
    // Commands write the overlay file, so they run one at a time.
    let queue: Promise<unknown> = Promise.resolve();
    const run = (arguments_: string[]): Promise<RunResult> => {
        const result = queue.then(() => options.run(arguments_));
        queue = result.catch(() => { /* the caller sees the failure */ });
        return result;
    };

    const send = (response: http.ServerResponse, status: number, body: unknown): void => {
        response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(body));
    };

    const config = async (): Promise<Record<string, string | undefined>> => {
        const result = await run(["config"]);
        const parsed = parse_json(result.stdout) as { configs?: { field_name: string; value: unknown }[] } | undefined;
        const values: Record<string, string | undefined> = {};
        for (const field of parsed?.configs ?? []) {
            if (VISIBLE_FIELDS.has(field.field_name)) {
                values[field.field_name] = typeof field.value === "string" ? field.value : undefined;
            }
        }
        return values;
    };

    return http.createServer((request, response) => {
        void (async () => {
            // A page on another site can reach 127.0.0.1 too; a rebinding host name gives itself away here.
            const host = request.headers.host ?? "";
            if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { send(response, 403, { error: "bad host" }); return; }

            const url = new URL(request.url ?? "/", "http://localhost");
            if (request.method === "GET" && url.pathname === "/") {
                response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
                response.end(options.page);
                return;
            }
            if (!url.pathname.startsWith("/api/")) { send(response, 404, { error: "not found" }); return; }
            if (request.headers["x-attach-token"] !== options.token) { send(response, 403, { error: "bad token" }); return; }

            if (request.method === "GET" && url.pathname === "/api/status") {
                send(response, 200, await config());
                return;
            }
            if (request.method === "GET" && url.pathname === "/api/overlay") {
                const values = await config();
                const overlay = values["overlay"];
                if (overlay === undefined || !fs.existsSync(overlay)) { send(response, 200, { path: overlay, text: "" }); return; }
                send(response, 200, { path: overlay, text: fs.readFileSync(overlay, "utf8") });
                return;
            }
            if (request.method === "POST" && url.pathname === "/api/cmd") {
                const body = await read_body(request);
                const checked = check_request(parse_json(body));
                if ("error" in checked) { send(response, 400, checked); return; }
                const [command] = checked.run;
                // There is no terminal behind the page to ask the missing-properties questions. Runs are
                // --json, which never asks; `add` still gets --quiet. `update` doesn't: there --quiet also
                // means "value only" for a read, and creating a child never asks under --json.
                const extra = command === "add" ? ["--quiet"] : [];
                const result = await run([...checked.run, ...extra]);
                send(response, 200, { code: result.code, json: parse_json(result.stdout), stdout: result.stdout, stderr: result.stderr });
                return;
            }
            send(response, 404, { error: "not found" });
        })().catch((error: unknown) => {
            if (response.headersSent) { response.end(); } else { send(response, 500, { error: String(error) }); }
        });
    });
}

if (import.meta.vitest) {
    const { test, expect, afterEach } = import.meta.vitest;

    const servers: http.Server[] = [];
    afterEach(() => { for (const s of servers.splice(0)) { s.close(); } });

    async function start(run: Runner): Promise<string> {
        const server = create_ui_server({ run, page: "<html>page</html>", token: "secret" });
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const address = server.address() as { port: number };
        return `http://127.0.0.1:${address.port}`;
    }

    const post = (base: string, body: unknown, token = "secret"): Promise<Response> =>
        fetch(`${base}/api/cmd`, { method: "POST", headers: { "x-attach-token": token }, body: JSON.stringify(body) });

    test("check_request allows the editing commands and their options only", () => {
        expect(check_request({ command: "read", args: ["/soc"] })).toEqual({ run: ["read", "/soc"] });
        expect(check_request({ command: "add", args: ["adi,ad7124-8", "--parent", "spi0"] })).toEqual({ run: ["add", "adi,ad7124-8", "--parent", "spi0"] });
        expect("error" in check_request({ command: "deploy", args: [] })).toBe(true);
        expect("error" in check_request({ command: "config", args: ["preprocess-command", "x"] })).toBe(true);
        expect("error" in check_request({ command: "toString", args: [] })).toBe(true);
        expect("error" in check_request({ command: "read", args: ["--json"] })).toBe(true);
        expect("error" in check_request({ command: "update", args: ["adc", "x", 1] })).toBe(true);
        // init may create a workfile, and takes no option.
        expect(check_request({ command: "init", args: [] })).toEqual({ run: ["init"] });
        expect("error" in check_request({ command: "init", args: ["--overlay", "overlay-1"] })).toBe(true);
        expect("error" in check_request({ command: "create-workfile", args: [] })).toBe(true);
    });

    test("the page is served, the API needs the token", async () => {
        const base = await start(async () => ({ code: 0, stdout: "{}", stderr: "" }));
        const page = await fetch(base);
        expect(await page.text()).toBe("<html>page</html>");
        const wrong = await post(base, { command: "read", args: ["/"] }, "wrong");
        const right = await post(base, { command: "read", args: ["/"] });
        expect(wrong.status).toBe(403);
        expect(right.status).toBe(200);
    });

    test("a foreign host name is refused", async () => {
        const base = await start(async () => ({ code: 0, stdout: "{}", stderr: "" }));
        const response = await new Promise<number>((resolve, reject) => {
            const port = new URL(base).port;
            http.get({ host: "127.0.0.1", port, path: "/", headers: { host: "evil.example" } }, r => { resolve(r.statusCode ?? 0); r.resume(); }).on("error", reject);
        });
        expect(response).toBe(403);
    });

    test("add runs without the interview; update keeps its read output, the result carries stdout, stderr and the parsed JSON", async () => {
        const calls: string[][] = [];
        const base = await start(async arguments_ => { calls.push(arguments_); return { code: 0, stdout: '{"ok":true}', stderr: "warning: x" }; });
        const response = await post(base, { command: "update", args: ["adc", "reg", "1"] });
        const body = await response.json() as { json: unknown; stderr: string };
        await post(base, { command: "add", args: ["adi,ad7124-8"] });
        expect(calls).toEqual([["update", "adc", "reg", "1"], ["add", "adi,ad7124-8", "--quiet"]]);
        expect(body).toMatchObject({ json: { ok: true }, stderr: "warning: x" });
    });

    test("status leaves out the deploy fields", async () => {
        const stdout = JSON.stringify({ configs: [
            { field_name: "linux", value: "/linux" },
            { field_name: "overlay", value: undefined },
            { field_name: "deploy-password", value: "hunter2" },
        ] });
        const base = await start(async () => ({ code: 0, stdout, stderr: "" }));
        const response = await fetch(`${base}/api/status`, { headers: { "x-attach-token": "secret" } });
        expect(await response.json()).toEqual({ linux: "/linux" });
    });

    test("commands run one at a time", async () => {
        let running = 0;
        let most = 0;
        const base = await start(async () => {
            running++; most = Math.max(most, running);
            await new Promise(resolve => setTimeout(resolve, 10));
            running--;
            return { code: 0, stdout: "{}", stderr: "" };
        });
        await Promise.all([1, 2, 3].map(() => post(base, { command: "read", args: ["/"] })));
        expect(most).toBe(1);
    });
}
