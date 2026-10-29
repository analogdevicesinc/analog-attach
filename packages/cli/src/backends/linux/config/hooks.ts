// The Linux backend's hooks into `config`: the checks `config linux` and `config workfile`
// made on top of the setting specs, the cache build after `config linux <path>`, and
// `config --reload`.

import * as fs from "node:fs";

import { answer, refuse, type Outcome, type Session, type SettingsHooks } from "../../../interface/backend-interface";
import type { CommonResponse } from "../../../interface/backend-responses";
import { creation_problem } from "../workfile";
import { reload_caches } from "./rebuild";
import { expand_home, read_settings } from "./settings";
import { config_errors_outcome, format_config_errors, linux_tree_problem, workspace_context } from "./workspace";

/** `config linux` needs a Linux tree; `config workfile` takes a file `init` has yet to create, in a directory that exists. */
function check(key: string, value: string): { ok: true } | { ok: false; message: string } {
    const file = expand_home(value);
    if (key === "linux") {
        const problem = linux_tree_problem(file);
        return problem === undefined ? { ok: true } : { ok: false, message: `linux: ${problem}` };
    }
    if (key === "workfile" && !fs.existsSync(file)) {
        const problem = creation_problem(file);
        return problem === undefined ? { ok: true } : { ok: false, message: `workfile: ${problem}` };
    }
    return { ok: true };
}

/** `Set linux = /l` and ` (global)` when the value now comes from the global settings, as the front end says it. */
function set_message(session: Session, key: string, value: string): string {
    const origin = session.settings.origin(key);
    return `Set ${key} = ${value}${typeof origin === "object" && origin.scope === "global" ? " (global)" : ""}`;
}

/** Build the binding caches for the Linux tree just set; a failure keeps the setting and says how to retry. */
async function linux_changed(session: Session, linux: string): Promise<Outcome<CommonResponse>> {
    const message = set_message(session, "linux", linux);
    const reloaded = await reload_caches(read_settings(session.settings), workspace_context(session), label => session.progress(label));
    if (!reloaded.ok) {
        return refuse(`${message}, but the binding caches were not built:\n${format_config_errors(reloaded.errors, session.program).human}`);
    }
    if (!reloaded.value.ok) {
        return refuse(`${message}, but ${reloaded.value.message}\nFix the bindings and run '${session.program} config --reload'.`);
    }
    const done = `${message}; ${reloaded.value.message}`;
    return answer({ ok: true, message: done, severity: "info" }, done);
}

async function changed(keys: readonly string[], session: Session): Promise<Outcome<CommonResponse> | undefined> {
    const linux = keys.includes("linux") ? session.settings.get("linux") : undefined;
    if (linux !== undefined) { return linux_changed(session, linux); }
    const workfile = keys.includes("workfile") ? session.settings.get("workfile") : undefined;
    if (workfile !== undefined && !fs.existsSync(workfile)) {
        const message = `${set_message(session, "workfile", workfile)} (not created yet: '${session.program} init' creates it)`;
        return answer({ ok: true, message, severity: "info" }, message);
    }
    return undefined;
}

async function reload(session: Session): Promise<Outcome<CommonResponse>> {
    const reloaded = await reload_caches(read_settings(session.settings), workspace_context(session), label => session.progress(label));
    if (!reloaded.ok) { return config_errors_outcome(session, reloaded.errors); }
    if (!reloaded.value.ok) { return refuse(reloaded.value.message); }
    return answer({ ok: true, message: reloaded.value.message, severity: "info" }, "Rebuilt the binding index and validation.json.");
}

export const linux_settings_hooks: SettingsHooks = {
    check: (key, value) => Promise.resolve(check(key, value)),
    changed,
    reload,
};

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");
    const { default: path } = await import("node:path");

    test("check - a Linux tree needs bindings and include/; a new workfile needs its directory", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-hooks-"));
        try {
            expect(check("linux", directory)).toMatchObject({ ok: false, message: expect.stringMatching(/^linux: /) as unknown });
            fs.mkdirSync(path.join(directory, "Documentation", "devicetree", "bindings"), { recursive: true });
            fs.mkdirSync(path.join(directory, "include"));
            expect(check("linux", directory)).toEqual({ ok: true });
            expect(check("workfile", path.join(directory, "new.dtso"))).toEqual({ ok: true });
            expect(check("workfile", path.join(directory, "gone", "new.dtso"))).toEqual({
                ok: false, message: `workfile: ${path.join(directory, "gone")} is not a directory`,
            });
            expect(check("overlay-syntax", "label")).toEqual({ ok: true });
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });
}
