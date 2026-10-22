import fs from "node:fs";
import path from "node:path";
import { buildCommand } from "@stricli/core";
import {
    create_workfile,
    export_minimal,
    find_soc,
    get_effective_setting_value,
    get_workfile_path,
    list_socs,
    soc_for_board
} from "attach-no-os-lib";
import { common_ok, type CreateWorkfileResponse } from "../protocol/responses";
import { output, output_error } from "./shared";

type InitFlags = {
    json?: boolean;
};

/**
 * `attach-noos init` — start a new workfile at the configured path.
 *
 * The protocol gives this command no arguments at all — its base schema declares no flags
 * and attach-meta dispatches it with an empty argv — so every input is a setting: `workfile`
 * says where, `board` (or `platform`, for the platforms that have none) says what for. There
 * are deliberately no per-run overrides: a workfile is created once and then read back by
 * `generate` from the same settings, so a target that lived only in one command's argv would
 * be a target nothing else could see.
 */
export const initCommand = buildCommand<InitFlags, []>({
    docs: {
        brief: "Create a new workfile at the configured path",
        fullDescription:
            "Creates the workfile named by the 'workfile' setting, for the board named by the\n" +
            "'board' setting (or the 'platform' setting, for platforms that have no boards).\n" +
            "Set them with 'attach-noos config'. Refuses to overwrite a workfile that already exists."
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags: InitFlags) => {
        const created = init_workfile();
        if (!created.ok) {
            output_error(flags, created.message, created.text === undefined ? {} : { text: created.text });
            return;
        }
        const response: CreateWorkfileResponse = {
            ...common_ok(created.message),
            path: created.path
        };
        output(flags, `${created.message}\n  ${created.path}`, response);
    }
});

export type InitResult =
    | { ok: true; message: string; path: string }
    | { ok: false; message: string; text?: string };

/**
 * Create the workfile the settings name, for the board (or platform) they name. Shared by
 * `init` and the guided setup, so both refuse and report the same way.
 */
export function init_workfile(): InitResult {
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

    const resolved = resolve_target();
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

/**
 * Which platform (and board) the new workfile targets.
 *
 * The board is the primary axis — it names its own platform — so `platform` only has to be
 * set for the platforms that have no boards at all (linux, mbed) or to start a workfile
 * before the board is decided.
 */
function resolve_target(): ResolvedTarget {
    const configured_board = setting("board");
    const configured_platform = setting("platform");

    if (configured_board === undefined && configured_platform === undefined) {
        return {
            ok: false,
            message: "No board or platform configured. Run: attach-noos config board <name>",
            text: format_no_target()
        };
    }

    // No board: the platform setting names the chip directly, which is how a chip with no
    // board module of its own is targeted.
    if (configured_board === undefined) {
        const soc = find_soc(configured_platform!);
        if (!soc.ok) {
            return { ok: false, message: soc.error.message };
        }
        return { ok: true, platform: configured_platform! };
    }

    // A board names its own chip, so it settles the platform on its own.
    const resolved = soc_for_board(configured_board);
    if (!resolved.ok) {
        return { ok: false, message: resolved.error.message };
    }

    // A configured platform that contradicts the board is a mistake worth reporting rather
    // than quietly resolving in the board's favour.
    if (configured_platform !== undefined && configured_platform !== resolved.value) {
        return {
            ok: false,
            message: `Board '${configured_board}' carries ${resolved.value}, not ${configured_platform}`
        };
    }

    return { ok: true, platform: resolved.value, board: configured_board };
}

function setting(key: "board" | "platform"): string | undefined {
    const value = get_effective_setting_value(key);
    return value.ok ? value.value : undefined;
}

// --- Formatters ---

function format_no_target(): string {
    let out = "No board or platform configured.\n\n";
    out += "  attach-noos config board <name>       a board settles the platform on its own\n";
    out += "  attach-noos config platform <name>    for a chip with no board of its own\n\n";

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
