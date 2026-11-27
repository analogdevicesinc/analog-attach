import type { Server } from "node:http";

export const DEFAULT_PORT: number;

/** Start the GUI's server; resolves once it listens (src/server.mjs). */
export function start_gui(options: {
	/** The command that runs the CLI, as an array: [node, "/path/to/cli.js"]. */
	cli: string[];
	/**
	 * Runs the CLI in the server's own process: `analog-attach <args>` in `cwd`, `environment` over
	 * the process's for that run only (a secret deploy needs). Without it, each run is a child
	 * process of `cli`. The long commands (/api/stream) and the chat always run `cli`.
	 */
	runner?: (args: readonly string[], cwd: string, environment?: Readonly<Record<string, string>>) => Promise<{ code: number; stdout: string; stderr: string }>;
	/**
	 * The skills of a backend (the CLI's `Backend.skills`): what the chat puts in the system prompt
	 * of a model with no skills of its own (an OpenAI-compatible one). Without it, none.
	 */
	skills?: (backend: string) => Promise<readonly { name: string; source_dir: string }[]>;
	/** The folder the CLI runs in: the GUI's project. */
	project: string;
	/** 127.0.0.1's port; 0 for any free one. Default DEFAULT_PORT. */
	port?: number;
	/** The folder of the page (index.html, core/, ecosystems/). Default: the server's own. */
	root?: string;
	/** When `port` is taken, try the next ports, then any free one (the port was not asked for). Default false: a taken port is an error. */
	next_free?: boolean;
}): Promise<{ server: Server; url: string; token: string }>;
