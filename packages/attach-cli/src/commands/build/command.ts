import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

import type { LocalContext } from "../../context";
import { save_config, DEFAULT_BUILD_COMMAND } from "../../config";
import { resolve_config } from "../../resolve-config";
import { substitute_command } from "../../utilities";
import { getBundledToolsPath } from "../skill/utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import type { BuildResponse } from "../../protocol/types";

/** Derive the compiled artifact path from the overlay source path. */
export function derive_dtbo_path(overlay: string): string {
    return overlay.endsWith(".dtso") ? `${overlay.slice(0, -".dtso".length)}.dtbo` : `${overlay}.dtbo`;
}

/** Substitute {dtc}/{input}/{output} placeholders, quoting paths so spaces are tolerated. */
export function substitute_build_command(template: string, input: string, output: string): string {
    const dtc = path.join(getBundledToolsPath(), "dtc");
    return substitute_command(template, { dtc, input, output });
}

export function build_build_command(context_: LocalContext): Command {
    return new Command("build")
        .description("Compile the overlay DTSO into a DTBO using dtc")
        .action(async () => {
            const resolved = resolve_config(context_, ["overlay"]);
            if (resolved === undefined) { return; }
            const input = resolved.values.overlay;

            const dtc = path.join(getBundledToolsPath(), "dtc");
            if (!fs.existsSync(dtc)) {
                const message = "Bundled dtc not found — run scripts/bundle-dt-schema.sh";
                if (context_.json) { input_error(message); return; }
                console.log(message);
                return;
            }

            const output = derive_dtbo_path(input);
            const template = resolved.config.buildCommand ?? DEFAULT_BUILD_COMMAND;
            const command = substitute_build_command(template, input, output);

            try {
                execSync(command, { stdio: "pipe" });
            } catch (error: any) {
                const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
                if (context_.json) { respond_fail({ ok: false, message: stderr, severity: "error" }); return; }
                console.log(`Build failed:\n${stderr}`);
                return;
            }

            save_config({ overlayCompiled: output });

            if (context_.json) {
                respond({ ok: true, message: "Compiled overlay", severity: "info", path: output } satisfies BuildResponse);
            } else {
                console.log(`Wrote ${output}`);
            }
        });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("derive_dtbo_path - swaps .dtso extension for .dtbo", () => {
        expect(derive_dtbo_path("/x/overlay.dtso")).toBe("/x/overlay.dtbo");
    });

    test("derive_dtbo_path - appends .dtbo when input is not .dtso", () => {
        expect(derive_dtbo_path("/x/overlay")).toBe("/x/overlay.dtbo");
    });

    test("substitute_build_command - replaces and quotes both placeholders", () => {
        expect(substitute_build_command("dtc -o {output} {input}", "/a b/in.dtso", "/a b/out.dtbo"))
            .toBe('dtc -o "/a b/out.dtbo" "/a b/in.dtso"');
    });

    test("substitute_build_command - replaces all occurrences", () => {
        expect(substitute_build_command("{input} {input}", "/x.dtso", "/x.dtbo"))
            .toBe('"/x.dtso" "/x.dtso"');
    });
}
