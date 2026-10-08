import { Command } from "commander";
import { DeviceTreeOverlay, type BoardDescription } from "attach-lib";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LocalContext } from "../../context";
import { load_config, DEFAULT_PREPROCESS_COMMAND } from "../../config";
import { load_board } from "../../board";
import { respond, respond_fail } from "../../protocol/output";
import type { CreateWorkfileResponse } from "../../protocol/types";
import { is_tool_available, substitute_command } from "../../utilities";
import { create_workfile } from "../../workfile";

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

export function build_create_workfile_command(context: LocalContext): Command {
    return new Command("create-workfile")
        .description("Create a new workfile (DTSO overlay); starts from the board's overlay when the configured board ships one")
        .option("--name <value>", "Output filename (default: overlay.dtso)")
        .action(async (options) => {
            const filename: string = options.name ?? "overlay.dtso";

            const result = create_workfile(load_config() ?? {}, filename);
            if ("error" in result) {
                if (context.json) {
                    respond_fail({ ok: false, message: result.error, severity: "error" });
                } else {
                    console.log(result.error);
                }
                return;
            }

            const message = [result.message, ...result.warnings].join("; ");
            if (context.json) {
                respond({
                    ok: true,
                    message: message.replace(/^Wrote /, "Created workfile "),
                    severity: result.warnings.length > 0 ? "warn" : "info",
                    path: result.path,
                } satisfies CreateWorkfileResponse);
            } else {
                console.log(result.message);
                for (const warning of result.warnings) { console.log(warning); }
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
