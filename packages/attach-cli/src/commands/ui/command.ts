import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { Command } from "commander";

import type { LocalContext } from "../../context";
import { input_error } from "../../protocol/output";
import { create_ui_server, type Runner } from "./server";

/** Runs this CLI again, in the directory the UI was started in, so the page sees what the terminal would. */
function cli_runner(): Runner {
    const script = process.argv[1] ?? "";
    return arguments_ => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...arguments_, "--json"], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        // The first run may build the compat index and validation schema, which takes minutes.
        const timer = setTimeout(() => { child.kill(); }, 10 * 60 * 1000);
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("close", code => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    });
}

/** `$BROWSER` (a program name, as for xdg-open and git web--browse) wins over the platform's opener. */
function open_browser(url: string): void {
    const browser = process.env["BROWSER"];
    const openers: Record<string, string[]> = { darwin: ["open"], win32: ["cmd", "/c", "start", ""] };
    const [command, ...rest] = browser !== undefined && browser !== "" ? [browser] : openers[process.platform] ?? ["xdg-open"];
    if (command === undefined) { return; }
    try {
        spawn(command, [...rest, url], { stdio: "ignore", detached: true }).on("error", () => { /* the URL is printed anyway */ }).unref();
    } catch {
        // The URL is printed anyway.
    }
}

export function build_ui_command(_context: LocalContext): Command {
    return new Command("ui")
        .description("Open a proof-of-concept browser UI for the overlay in the current directory")
        .option("--port <number>", "Port to listen on (default: any free port)", "0")
        .option("--open", "Open the page in the default browser ($BROWSER overrides it, e.g. BROWSER=firefox)")
        .addHelpText("after", `
The server listens on 127.0.0.1 only. The page runs the same commands as the
terminal (read, list, add, update, delete, enable, disable, validate) against
the config in the current directory, so the overlay file it edits is the one
'attach-linux read' shows.

Example:
  $ attach-linux ui --open`)
        .action(async (options: { port: string; open?: boolean }) => {
            const port = Number(options.port);
            if (!Number.isInteger(port) || port < 0 || port > 65_535) { input_error(`Invalid port: ${options.port}`); return; }

            const { default: page } = await import("./index.html");
            const token = randomBytes(24).toString("hex");
            const server = create_ui_server({ run: cli_runner(), page, token });
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(port, "127.0.0.1", resolve);
            });
            const address = server.address();
            const bound = typeof address === "object" && address !== null ? address.port : port;
            const url = `http://127.0.0.1:${bound}/#${token}`;
            console.log(`attach-linux UI: ${url}`);
            console.log("Press Ctrl+C to stop.");
            if (options.open === true) { open_browser(url); }
            // Stays running until the process is interrupted.
            await new Promise<void>(resolve => { server.on("close", resolve); });
        });
}
