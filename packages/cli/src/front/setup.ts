// The bare run: `analog-attach` alone on a terminal (C-01, decision 3).
//
//   1. With no backend set (or one the registry doesn't have), ask which, by title, and save
//      `backend` in the project's settings.
//   2. Run the backend's `setup`. When its response is `ready`, run the backend's `init`, and
//      end with its outcome.
//   3. A backend without `setup`: list its required settings that are unset.
//
// Off a terminal, the bare run is the usage (main.ts); it never gets here.

import {
    answer, input_error, refuse,
    type Backend, type InteractiveSession, type Outcome, type Session,
} from "../interface/backend-interface";
import type { SetupResponse } from "../interface/backend-responses";
import { config_errors } from "./config";
import { force } from "./output";
import type { FrontEnd } from "./routes";
import { BACKEND_KEY, CONFIG_FILE, display_path } from "./settings-store";

function interactive(session: Session): InteractiveSession {
    if (session.prompter === undefined) { throw new Error("The bare run needs a terminal to ask on"); }
    return session as InteractiveSession;
}

/** Ask which backend, save it, and reopen the front end with it. */
async function choose_backend(front: FrontEnd, reopen: () => Promise<FrontEnd>): Promise<FrontEnd | Outcome<never>> {
    const loaded = await Promise.all(Object.entries(front.registry).map(async ([id, load]) => ({ id, backend: await load() })));
    if (loaded.length === 0) { return refuse("No backend is registered in this build"); }
    const session = interactive(await front.session("text", true));
    const id = await session.prompter.select({
        message: "What does this project target?",
        choices: loaded.map(({ id: value, backend }) => ({ name: `${backend.title} (${value})`, value })),
    });
    const write = await front.settings.set(BACKEND_KEY, id);
    if (!write.ok) { return input_error(write.message); }
    session.say(`Saved backend = ${id} to ${display_path(write.file, front.home)}.`);
    session.say("");
    const reopened = await reopen();
    if (reopened.backend === undefined) { throw new Error(`The ${id} backend didn't load: ${reopened.backend_problem ?? ""}`); }
    return reopened;
}

/** Step 3: the required settings that are unset, with their hints. */
function unset_required(backend: Backend, front: FrontEnd): Outcome<SetupResponse> {
    const missing = backend.settings.filter(spec => spec.required && front.settings.origin(spec.key) === "unset");
    if (missing.length === 0) {
        const message = `${backend.title}: every required setting is set`;
        return answer({ ok: true, message, severity: "info", saved: [], ready: true }, message);
    }
    const message = `${backend.title}: required settings that are unset: ${missing.map(spec => spec.key).join(", ")}`;
    const hints = [...new Set(missing.map(spec => spec.hint ?? `Run '${front.program} config ${spec.key} <value>'.`))];
    const text = [
        `${backend.title} needs these settings:`,
        ...missing.map(spec => `  ${spec.key} — ${spec.description}`),
        "",
        ...hints,
    ].join("\n");
    return answer({ ok: true, message, severity: "warn", saved: [], ready: false }, text);
}

/** The bare run. `reopen` reads the settings and loads the backend again, once `backend` is saved. */
export async function bare_run(front: FrontEnd, reopen: () => Promise<FrontEnd>): Promise<Outcome<unknown>> {
    // A settings file that isn't JSON stops it before anything is asked (exit 2); a bad key is saved over.
    const unreadable = front.settings.errors.filter(error => error.field === CONFIG_FILE);
    if (unreadable.length > 0) { return config_errors(unreadable, false); }
    let current = front;
    if (current.backend === undefined) {
        const chosen = await choose_backend(current, reopen);
        if ("kind" in chosen) { return chosen; }
        current = chosen;
    }
    const backend = current.backend!;
    if (backend.setup === undefined) { return unset_required(backend, current); }

    const session = interactive(await current.session("text", true));
    const outcome = await backend.setup(session);
    if (outcome.kind !== "answer") { return outcome; }
    const response = await force(outcome.response);
    const init = backend.commands.init;
    if (!response.ready || init === undefined) { return { ...outcome, response }; }
    // Setup's summary first, then init's outcome ends the run.
    const text = outcome.text(session.style);
    if (text !== "") { session.say(text); }
    return init.run({}, {}, session);
}
