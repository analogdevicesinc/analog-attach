import type { Server } from "node:http";

export const DEFAULT_PORT: number;

/** Start the GUI's server; resolves once it listens (src/server.mjs). */
export function start_gui(options: {
    /** The command that runs the CLI, as an array: [node, "/path/to/cli.js"]. */
    cli: string[];
    /** The folder the CLI runs in; the page can change it. */
    project: string;
    /** 127.0.0.1's port; 0 for any free one. Default DEFAULT_PORT. */
    port?: number;
    /** The folder of the page (index.html, core/, ecosystems/). Default: the server's own. */
    root?: string;
}): Promise<{ server: Server; url: string; token: string }>;
