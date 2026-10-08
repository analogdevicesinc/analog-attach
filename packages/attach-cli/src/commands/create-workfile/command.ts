import { Command } from "commander";
import { DeviceTreeOverlay, type BoardDescription } from "attach-lib";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LocalContext } from "../../context";
import { load_config, save_config, DEFAULT_PREPROCESS_COMMAND, type AttachConfig } from "../../config";
import { load_board, resolve_board_overlay } from "../../board";
import { respond, respond_fail } from "../../protocol/output";
import type { CreateWorkfileResponse } from "../../protocol/types";
import { is_tool_available, substitute_command } from "../../utilities";

const EMPTY_DTSO = String.raw`/dts-v1/;
/plugin/;

/ {
};
`;

/**
 * Turn a board's shipped overlay into a workfile: run the preprocess command
 * (includes and macros), parse, and drop `__overrides__` (Raspberry Pi
 * firmware dtparam glue whose references break once nodes are edited).
 * Warns about `onboard` slot labels the overlay doesn't define.
 */
export function prepare_board_workfile(
    board: BoardDescription,
    overlay_path: string,
    template: string,
    linux?: string,
): { text: string, warnings: string[] } | { error: string } {
    if (template.includes("{linux}") && linux === undefined) {
        return { error: `preprocess-command uses {linux} but linux is not set (export ATTACH_LINUX=<path>)` };
    }
    const tool = template.trim().split(/\s+/)[0] ?? "";
    if (!is_tool_available(`${tool} --version`)) {
        return { error: `${tool} not found on PATH (needed to preprocess ${overlay_path})` };
    }

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-overlay-"));
    let preprocessed: string;
    try {
        const output = path.join(directory, "overlay.dtso");
        execSync(substitute_command(template, { input: overlay_path, output, ...(linux === undefined ? {} : { linux }) }), { stdio: "pipe" });
        preprocessed = fs.readFileSync(output, "utf8");
    } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
        return { error: `preprocessing ${overlay_path} failed:\n${stderr}` };
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }

    const overlay = DeviceTreeOverlay.new_from_string(preprocessed);
    if (typeof overlay === "string") { return { error: `${overlay_path}: ${overlay}` }; }
    overlay.remove_root_node("__overrides__");

    const warnings = board.slots
        .filter(slot => slot.onboard !== undefined
            && overlay.find_node({ kind: "label", labels: [], name: slot.onboard.slice(1) }) === undefined)
        .map(slot => `slot ${slot.id}: onboard ${slot.onboard} is not defined in ${path.basename(overlay_path)}`);

    return { text: overlay.print(), warnings };
}

/** The workfile to start from: the configured board's overlay when it ships one, otherwise an empty overlay. */
function initial_workfile(config: AttachConfig): { text: string, source?: string, warnings: string[], persist: Partial<AttachConfig> } | { error: string } {
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
        // Write the command used to the config so it is visible and editable.
        persist: config.preprocessCommand === undefined ? { preprocessCommand: template } : {},
    };
}

export function build_create_workfile_command(context: LocalContext): Command {
    return new Command("create-workfile")
        .description("Create a new workfile (DTSO overlay); starts from the board's overlay when the configured board ships one")
        .option("--name <value>", "Output filename (default: overlay.dtso)")
        .action(async (options) => {
            const filename: string = options.name ?? "overlay.dtso";

            const initial = initial_workfile(load_config() ?? {});
            if ("error" in initial) {
                if (context.json) {
                    respond_fail({ ok: false, message: initial.error, severity: "error" });
                } else {
                    console.log(initial.error);
                }
                return;
            }

            const output_path = path.resolve(process.cwd(), filename);
            fs.writeFileSync(output_path, initial.text);

            save_config({ overlay: output_path, ...initial.persist });

            const from = initial.source === undefined ? "" : ` from ${initial.source}`;
            const message = [`Created workfile${from}`, ...initial.warnings].join("; ");
            if (context.json) {
                respond({
                    ok: true,
                    message,
                    severity: initial.warnings.length > 0 ? "warn" : "info",
                    path: output_path,
                } satisfies CreateWorkfileResponse);
            } else {
                console.log(`Wrote ${output_path}${from}`);
                for (const warning of initial.warnings) { console.log(warning); }
            }
        });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "bundled");
    const overlay_path = path.join(bundled, "overlays", "rpi-adalm-lsmspg-overlay.dts");
    const board = load_board(path.join(bundled, "boards", "adalm-lsmspg.yaml"));
    if (typeof board === "string") { throw new TypeError(board); }

    // A stand-in Linux tree holding only the header the overlay includes.
    const with_linux = (run: (linux: string) => void) => {
        const linux = fs.mkdtempSync(path.join(os.tmpdir(), "attach-linux-"));
        try {
            const bindings = path.join(linux, "include", "dt-bindings", "iio");
            fs.mkdirSync(bindings, { recursive: true });
            fs.writeFileSync(path.join(bindings, "adi,ad5592r.h"), [
                "#define CH_MODE_UNUSED 0", "#define CH_MODE_ADC 1", "#define CH_MODE_DAC 2",
                "#define CH_MODE_DAC_AND_ADC 3", "#define CH_MODE_GPIO 8",
                "#define CH_OFFSTATE_PULLDOWN 0", "#define CH_OFFSTATE_OUT_LOW 1",
                "#define CH_OFFSTATE_OUT_HIGH 2", "#define CH_OFFSTATE_OUT_TRISTATE 3", "",
            ].join("\n"));
            run(linux);
        } finally {
            fs.rmSync(linux, { recursive: true });
        }
    };

    test.skipIf(!is_tool_available("cpp --version"))("prepare_board_workfile — preprocesses the shipped overlay and drops __overrides__", () => {
        with_linux(linux => {
            const prepared = prepare_board_workfile(board, overlay_path, DEFAULT_PREPROCESS_COMMAND, linux);
            if ("error" in prepared) { throw new TypeError(prepared.error); }
            expect(prepared.warnings).toStrictEqual([]);
            expect(prepared.text).toContain("adi,mode = <2>");
            expect(prepared.text).toContain(`compatible = "brcm,bcm2835"`);
            expect(prepared.text).not.toContain("__overrides__");
            expect(prepared.text).not.toContain("CH_MODE");
            expect(typeof DeviceTreeOverlay.new_from_string(prepared.text)).not.toBe("string");

            if (is_tool_available("dtc --version")) {
                const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-dtc-"));
                try {
                    const input = path.join(directory, "w.dtso");
                    fs.writeFileSync(input, prepared.text);
                    execSync(`dtc -@ -I dts -O dtb -o "${path.join(directory, "w.dtbo")}" "${input}"`, { stdio: "pipe" });
                } finally {
                    fs.rmSync(directory, { recursive: true });
                }
            }
        });
    });

    test("prepare_board_workfile — reports a missing linux tree and missing tool", () => {
        expect(prepare_board_workfile(board, overlay_path, DEFAULT_PREPROCESS_COMMAND))
            .toStrictEqual({ error: "preprocess-command uses {linux} but linux is not set (export ATTACH_LINUX=<path>)" });
        expect(prepare_board_workfile(board, overlay_path, "no-such-preprocessor -o {output} {input}"))
            .toStrictEqual({ error: `no-such-preprocessor not found on PATH (needed to preprocess ${overlay_path})` });
    });

    test.skipIf(!is_tool_available("cpp --version"))("prepare_board_workfile — warns about onboard labels the overlay lacks", () => {
        with_linux(linux => {
            const renamed = { ...board, slots: board.slots.map(slot => slot.id === "lm75" ? { ...slot, onboard: "&temp" } : slot) };
            const prepared = prepare_board_workfile(renamed, overlay_path, DEFAULT_PREPROCESS_COMMAND, linux);
            if ("error" in prepared) { throw new TypeError(prepared.error); }
            expect(prepared.warnings).toStrictEqual(["slot lm75: onboard &temp is not defined in rpi-adalm-lsmspg-overlay.dts"]);
        });
    });
}
