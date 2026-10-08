import * as fs from "node:fs";
import path from "node:path";

import { save_config, DEFAULT_PREPROCESS_COMMAND, type AttachConfig } from "./config";
import { load_board, resolve_board_overlay } from "./board";
import { prepare_board_workfile } from "./commands/create-workfile/command";

const EMPTY_DTSO = String.raw`/dts-v1/;
/plugin/;

/ {
};
`;

export { EMPTY_DTSO };

/** The workfile to start from: the configured board's overlay when it ships one, otherwise an empty overlay. */
export function initial_workfile(config: AttachConfig): { text: string; source?: string; warnings: string[]; persist: Partial<AttachConfig> } | { error: string } {
    if (config.board === undefined) { return { text: EMPTY_DTSO, warnings: [], persist: {} }; }

    const board = load_board(config.board);
    if (typeof board === "string") { return { error: `board ${config.board}: ${board}` }; }
    const overlay_path = resolve_board_overlay(config.board, board);
    if (overlay_path === undefined) { return { text: EMPTY_DTSO, warnings: [], persist: {} }; }

    const template = config.preprocessCommand ?? DEFAULT_PREPROCESS_COMMAND;
    const prepared = prepare_board_workfile(board, overlay_path, template, config.linux);
    if ("error" in prepared) { return prepared; }
    return {
        text: prepared.text,
        source: overlay_path,
        warnings: prepared.warnings,
        persist: config.preprocessCommand === undefined ? { preprocessCommand: template } : {},
    };
}

export interface CreateWorkfileResult {
    path: string;
    source?: string;
    warnings: string[];
    message: string;
}

/**
 * Create a workfile and save the overlay path to config.
 * Used by both `create-workfile` and `add` (when no overlay is configured).
 */
export function create_workfile(
    config: AttachConfig,
    filename = "overlay.dtso",
    cwd?: string,
): CreateWorkfileResult | { error: string } {
    const initial = initial_workfile(config);
    if ("error" in initial) { return initial; }

    const output_path = path.resolve(cwd ?? process.cwd(), filename);
    fs.writeFileSync(output_path, initial.text);
    save_config({ overlay: output_path, ...initial.persist });

    const from = initial.source === undefined ? "" : ` from ${initial.source}`;
    return {
        path: output_path,
        source: initial.source,
        warnings: initial.warnings,
        message: `Wrote ${output_path}${from}`,
    };
}
