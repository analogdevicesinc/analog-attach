// The backends the front end knows, by the value of the `backend` setting. Each loader is a
// dynamic import, so the bundle keeps every backend in its own chunk and a run loads only
// the active one (a no-OS run never loads linux-lib).

import type { BackendLoader } from "../interface/backend-interface";

export type Registry = Readonly<Record<string, BackendLoader>>;

export const BACKENDS: Registry = {
	linux: () => import("../backends/linux/index").then(module => module.backend),
	noos: () => import("../backends/noos/index").then(module => module.backend),
};

/**
 * The backends no project may pick for now: `config backend`, the bare run's question, the
 * GUI's ecosystem step, completion and the hints leave them out. A project whose settings name
 * one already still runs it (and its tests do). noos: not offered for the foreseeable future.
 */
export const UNLISTED: ReadonlySet<string> = new Set(["noos"]);
