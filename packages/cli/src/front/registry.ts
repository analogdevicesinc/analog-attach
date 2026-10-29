// The backends the front end knows, by the value of the `backend` setting. Each loader is a
// dynamic import, so the bundle keeps every backend in its own chunk and a run loads only
// the active one (a no-OS run never loads attach-lib or the bundled dt-schema).

import type { BackendLoader } from "../interface/backend-interface";

export type Registry = Readonly<Record<string, BackendLoader>>;

export const BACKENDS: Registry = {
    linux: () => import("../backends/linux/index").then(module => module.backend),
    noos: () => import("../backends/noos/index").then(module => module.backend),
};
