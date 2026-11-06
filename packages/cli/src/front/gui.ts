// `analog-attach gui [--port <n>] [--server-only]`: the GUI (packages/gui) for the project in
// the current directory. It starts the GUI's server on 127.0.0.1, which runs this same CLI for
// every action of the page, opens the page in the browser, and runs until stopped (Ctrl-C).
// The page is packages/gui's own when the CLI runs from the repository, else the copy bundled
// with the CLI (`bundled/gui/index.html`). It handles noos projects for now: elsewhere, help and
// completion leave it out.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { DEFAULT_PORT, start_gui } from "@analog-attach/gui/server";
import { answer, input_error, type Outcome, type Session } from "../interface/backend-interface";
import type { CommonResponse } from "../interface/backend-responses";
import type { FrontEnd, Route } from "./routes";

export interface GuiResponse extends CommonResponse {
    /** Where the GUI was served, once it has stopped. */
    url: string;
}

/**
 * The page: the GUI package's own when the CLI runs from the repository (so an edit shows on a
 * reload, with no build), else the copy bundled with the CLI.
 */
function page(root: string): string | undefined {
    const candidates = [path.join(root, "..", "gui", "src", "index.html"), path.join(root, "bundled", "gui", "index.html")];
    return candidates.find(candidate => fs.existsSync(candidate));
}

/** Open a URL in the user's browser; nothing when no opener is there (the URL is printed anyway). */
function open_browser(url: string): void {
    const openers: Partial<Record<NodeJS.Platform, string>> = { darwin: "open", win32: "explorer" };
    const opener = openers[process.platform] ?? "xdg-open";
    try {
        spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => { /* the URL is on stderr */ }).unref();
    } catch {
        // No opener: the URL is on stderr.
    }
}

/** Start the GUI and wait until it is stopped. `root` is the CLI's package directory. */
async function run_gui(front: FrontEnd, root: string, port_text: string | undefined, server_only: boolean, session: Session): Promise<Outcome<GuiResponse>> {
    const port = port_text === undefined ? DEFAULT_PORT : Number(port_text);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) { return input_error(`--port takes a port number (0 to 65535), got ${port_text ?? ""}`); }
    const html = page(root);
    if (html === undefined) { throw new Error(`The GUI's page is missing: no ${path.join(root, "bundled", "gui", "index.html")}`); }
    const cli = [process.execPath, path.join(root, "dist", "cli.js")];
    const { server, url } = await start_gui({ cli, project: session.cwd, port, html });
    session.warn(`${front.program} GUI on ${url}  (project: ${session.cwd}). Stop it with Ctrl-C.`);
    if (!server_only) { open_browser(url); }
    await new Promise<void>(resolve => {
        server.on("close", resolve);
        process.once("SIGINT", () => { server.close(); });
    });
    return answer({ ok: true, message: `Stopped the GUI at ${url}`, severity: "info", url }, `Stopped the GUI at ${url}`);
}

export function gui_route(front: FrontEnd, root: () => string): Route {
    return {
        path: ["gui"],
        brief: "Open the GUI for this project in the browser",
        full: `Open the GUI for the project in the current directory: a page in the browser that runs
${front.program} for you (the workfile, adding devices, the graph, settings, generate and build).
It serves the page on 127.0.0.1 only, and runs until stopped with Ctrl-C. For now it handles
noos projects.`,
        examples: ["gui", "gui --port 8080", "gui --server-only"],
        group: "tooling",
        // The page handles noos projects for now: offered there only (GEN-03), still run when typed.
        hidden: front.backend?.id !== "noos",
        positionals: [],
        flags: {
            port: { kind: "value", brief: `Port on 127.0.0.1 to serve it on (default ${String(DEFAULT_PORT)}; 0: any free one)`, placeholder: "port" },
            "server-only": { kind: "boolean", brief: "Serve it without opening the browser" },
        },
        asks: false,
        supported: true,
        run: (input, session) => run_gui(front, root(),
            typeof input.flags["port"] === "string" ? input.flags["port"] : undefined, input.flags["server-only"] === true, session),
    };
}
