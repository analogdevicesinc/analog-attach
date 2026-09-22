import fs from "node:fs";
import path from "node:path";
import { buildCommand } from "@stricli/core";
import {
    PlatformSpecs,
    create_workfile,
    export_minimal,
    get_effective_setting_value,
    get_workfile_path,
    resolve_platform_from_board
} from "attach-no-os-lib";
import { common_ok, type CreateWorkfileResponse } from "../protocol/responses";
import { get_platform_specs, output, output_error } from "./shared";

type CreateWorkfileFlags = {
    json?: boolean;
};

/**
 * `attach-noos create-workfile` — start a new workfile at the configured path.
 *
 * The protocol gives this command no arguments at all — its base schema declares no flags
 * and attach-meta dispatches it with an empty argv — so every input is a setting: `workfile`
 * says where, `board` (or `platform`, for the platforms that have none) says what for. There
 * are deliberately no per-run overrides: a workfile is created once and then read back by
 * `generate` from the same settings, so a target that lived only in one command's argv would
 * be a target nothing else could see.
 */
export const createWorkfileCommand = buildCommand<CreateWorkfileFlags, []>({
    docs: {
        brief: "Create a new workfile at the configured path",
        fullDescription:
            "Creates the workfile named by the 'workfile' setting, for the board named by the\n" +
            "'board' setting (or the 'platform' setting, for platforms that have no boards).\n" +
            "Set them with 'attach-noos tool-config-set'. Refuses to overwrite a workfile that already exists."
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags: CreateWorkfileFlags) => {
        const target = get_workfile_path();
        if (!target.ok) {
            output_error(flags, target.error.message);
            return;
        }

        // Never silently: a workfile is the user's design, and this command would replace
        // it with an empty one.
        if (fs.existsSync(target.value)) {
            output_error(
                flags,
                `A workfile already exists at ${target.value}`,
                { text: `A workfile already exists at ${target.value}.\nDelete it, or point the 'workfile' setting somewhere else.` }
            );
            return;
        }

        const specs = get_platform_specs();
        if (!specs.ok) {
            output_error(flags, specs.error.message);
            return;
        }

        const resolved = resolve_target(specs.value);
        if (!resolved.ok) {
            output_error(flags, resolved.message, { text: resolved.text });
            return;
        }

        const workfile = create_workfile(resolved.platform);
        if (!workfile.ok) {
            output_error(flags, workfile.error.message);
            return;
        }

        // Recorded so the board travels with the workfile: codegen reads it from there,
        // which is what makes a workfile buildable on a machine configured differently.
        if (resolved.board !== undefined) {
            workfile.value.board = resolved.board;
        }

        const minimal = export_minimal(workfile.value);
        if (!minimal.ok) {
            output_error(flags, minimal.error.message);
            return;
        }

        fs.mkdirSync(path.dirname(target.value), { recursive: true });
        fs.writeFileSync(target.value, JSON.stringify(minimal.value, undefined, 2));

        const description = resolved.board === undefined
            ? `platform ${resolved.platform}`
            : `board ${resolved.board} (platform ${resolved.platform})`;
        const message = `Created a workfile for ${description}`;

        const response: CreateWorkfileResponse = {
            ...common_ok(message),
            path: target.value
        };

        output(flags, `${message}\n  ${target.value}`, response);
    }
});

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
function resolve_target(specs: PlatformSpecs): ResolvedTarget {
    const configured_board = setting("board");
    const configured_platform = setting("platform");

    if (configured_board === undefined && configured_platform === undefined) {
        return {
            ok: false,
            message: "No board or platform configured. Run: attach-noos tool-config-set board <name>",
            text: format_no_target(specs)
        };
    }

    if (configured_board === undefined) {
        if (!(configured_platform! in specs)) {
            return {
                ok: false,
                message: `Unknown platform '${configured_platform}'. Available: ${Object.keys(specs).join(", ")}`
            };
        }
        return { ok: true, platform: configured_platform! };
    }

    const noos_path = get_effective_setting_value("no_os_path");
    if (!noos_path.ok) {
        return { ok: false, message: noos_path.error.message };
    }
    if (noos_path.value === undefined) {
        return { ok: false, message: "no_os_path is not configured. Run: attach-noos tool-config-set no_os_path <path>" };
    }

    const resolved = resolve_platform_from_board(noos_path.value, configured_board, specs);
    if (!resolved.ok) {
        return { ok: false, message: resolved.error.message };
    }

    // A configured platform that contradicts the board is a mistake worth reporting rather
    // than quietly resolving in the board's favour.
    if (configured_platform !== undefined && configured_platform !== resolved.value.platform) {
        return {
            ok: false,
            message: `Board '${configured_board}' belongs to platform ${resolved.value.platform}, not ${configured_platform}`
        };
    }

    return { ok: true, platform: resolved.value.platform, board: resolved.value.board.name };
}

function setting(key: "board" | "platform"): string | undefined {
    const value = get_effective_setting_value(key);
    return value.ok ? value.value : undefined;
}

// --- Formatters ---

function format_no_target(specs: PlatformSpecs): string {
    let out = "No board or platform configured.\n\n";
    out += "  attach-noos tool-config-set board <name>       a board settles the platform on its own\n";
    out += "  attach-noos tool-config-set platform <name>    for platforms with no boards\n\n";
    out += "Available platforms:\n\n";

    for (const [name, manifest] of Object.entries(specs)) {
        out += `  ${name}\n`;
        for (const line of wrap_text(manifest.description ?? "No description available", 76)) {
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
