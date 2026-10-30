import fs from "node:fs";
import path from "node:path";
import {
    create_workfile,
    export_minimal,
    TARGET_SETTING,
    get_effective_setting_value,
    get_workfile_path,
    list_socs,
    resolve_target
} from "attach-no-os-lib";
import { answer, command, refuse, type InitArguments, type Session } from "../../../interface/backend-interface";
import type { InitResponse } from "../protocol/responses";
import { install } from "../settings";

/**
 * `init` - start a new workfile at the configured path.
 *
 * Every input is a setting: `workfile` says where, `target` (a board, or a chip with no
 * board of its own) says what for. There are deliberately no per-run overrides: a
 * workfile is created once and then read back by `generate` from the same settings, so a
 * target that lived only in one command's argv would be a target nothing else could see.
 */
export const init = command<InitArguments, InitResponse>({
    docs: {
        brief: "Create a new workfile at the configured path",
        full:
            "Creates the workfile named by the 'workfile' setting, for what the 'target' setting\n" +
            "names: a board, or a chip with no board of its own. Set them with 'analog-attach config'.\n" +
            "Refuses to overwrite a workfile that already exists."
    },
    run(_arguments, _flags, session) {
        const created = init_workfile(session);
        if (!created.ok) {
            return Promise.resolve(refuse(created.message, created.text === undefined ? {} : { text: created.text }));
        }
        const response: InitResponse = { ok: true, message: created.message, severity: "info", path: created.path, created: true };
        return Promise.resolve(answer(response, `${created.message}\n  ${created.path}`));
    }
});

export type InitResult =
    | { ok: true; message: string; path: string }
    | { ok: false; message: string; text?: string };

/**
 * Create the workfile the settings name, for the target (board or chip) they name. Shared by
 * `init` and the guided setup, so both refuse and report the same way.
 */
export function init_workfile(session: Pick<Session, "settings" | "assets_dir" | "program">): InitResult {
    install(session);
    const target = get_workfile_path();
    if (!target.ok) {
        return { ok: false, message: target.error.message };
    }

    // Never silently: a workfile is the user's design, and this would replace it with an
    // empty one.
    if (fs.existsSync(target.value)) {
        return {
            ok: false,
            message: `A workfile already exists at ${target.value}`,
            text: `A workfile already exists at ${target.value}.\nDelete it, or point the 'workfile' setting somewhere else.`
        };
    }

    const resolved = workfile_target(session.program);
    if (!resolved.ok) {
        return resolved;
    }

    const workfile = create_workfile(resolved.platform);
    if (!workfile.ok) {
        return { ok: false, message: workfile.error.message };
    }

    // Recorded so the board travels with the workfile: codegen reads it from there,
    // which is what makes a workfile buildable on a machine configured differently.
    if (resolved.board !== undefined) {
        workfile.value.board = resolved.board;
    }

    const minimal = export_minimal(workfile.value);
    if (!minimal.ok) {
        return { ok: false, message: minimal.error.message };
    }

    fs.mkdirSync(path.dirname(target.value), { recursive: true });
    fs.writeFileSync(target.value, JSON.stringify(minimal.value, undefined, 2));

    const description = resolved.board === undefined
        ? `platform ${resolved.platform}`
        : `board ${resolved.board} (platform ${resolved.platform})`;
    return { ok: true, message: `Created a workfile for ${description}`, path: target.value };
}

// --- Target resolution ---

type ResolvedTarget =
    | { ok: true; platform: string; board?: string }
    | { ok: false; message: string; text?: string };

/** Which platform (and board) the new workfile targets: what the `target` setting names. */
function workfile_target(program: string): ResolvedTarget {
    const configured = get_effective_setting_value(TARGET_SETTING);
    if (!configured.ok || configured.value === undefined) {
        return {
            ok: false,
            message: `No target configured. Run: ${program} config target <board or chip>, or ${program} for the guided setup`,
            text: format_no_target(program)
        };
    }
    const resolved = resolve_target(configured.value);
    return resolved.ok ? { ok: true, ...resolved.value } : { ok: false, message: resolved.error.message };
}

// --- Formatters ---

function format_no_target(program: string): string {
    let out = "No target configured.\n\n";
    const width = `${program} config target <board>`.length + 4;
    out += `  ${`${program} config target <board>`.padEnd(width)}a board brings its chip\n`;
    out += `  ${`${program} config target <chip>`.padEnd(width)}for a chip with no board of its own\n`;
    out += `  ${`${program} list context`.padEnd(width)}the boards and chips there are\n`;
    out += `  ${program.padEnd(width)}the guided setup, which asks for what is missing\n\n`;

    const socs = list_socs();
    if (!socs.ok) {
        out += socs.error.message;
        return out;
    }

    out += "Available chips:\n\n";
    for (const { soc, platform } of socs.value) {
        out += `  ${soc.name}\n`;
        const detail = [platform.name, soc.cpu].filter(Boolean).join(", ");
        for (const line of wrap_text(detail || "No description available", 76)) {
            out += `      ${line}\n`;
        }
        out += "\n";
    }

    return out.trimEnd();
}

/** Wrap text to `width` on word boundaries. A blank input yields one empty line. */
function wrap_text(text: string, width: number): string[] {
    const words = text.trim().split(/\s+/);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
        if (current.length === 0) {
            current = word;
        } else if (current.length + 1 + word.length <= width) {
            current += ` ${word}`;
        } else {
            lines.push(current);
            current = word;
        }
    }
    lines.push(current);

    return lines;
}
