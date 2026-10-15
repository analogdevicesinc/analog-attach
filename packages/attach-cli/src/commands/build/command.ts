import { Command } from "commander";
import { execSync } from "node:child_process";

import type { LocalContext } from "../../context";
import { derive_dtbo_path, load_workspace } from "../../config/workspace";
import { substitute_command } from "../../utilities";
import { respond, respond_fail } from "../../protocol/output";
import type { BuildResponse } from "../../protocol/types";

/** dtc invocation that compiles the overlay; {dtc}/{input}/{output} are substituted. */
export const BUILD_COMMAND = "{dtc} -@ -I dts -O dtb -o {output} {input}";

export function build_build_command(context_: LocalContext): Command {
    return new Command("build")
        .description("Compile the overlay into a .dtbo")
        .addHelpText("after", `
Compiles the configured overlay file into a binary .dtbo.
Output path is derived from the overlay (e.g. overlay.dtso -> overlay.dtbo).`)
        .action(async () => {
            const workspace = load_workspace(context_, ["tools", "base", "overlay"]);
            if (workspace === undefined) { return; }
            const input = workspace.overlay.path;

            const output = derive_dtbo_path(input);
            const command = substitute_command(BUILD_COMMAND, { dtc: workspace.tools.dtc, input, output });

            try {
                execSync(command, { stdio: "pipe" });
            } catch (error: any) {
                const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
                if (context_.json) { respond_fail({ ok: false, message: stderr, severity: "error" }); return; }
                console.log(`Build failed:\n${stderr}`);
                return;
            }

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

    test("BUILD_COMMAND - substitutes and quotes every placeholder", () => {
        expect(substitute_command(BUILD_COMMAND, { dtc: "/t/dtc", input: "/a b/in.dtso", output: "/a b/out.dtbo" }))
            .toBe('"/t/dtc" -@ -I dts -O dtb -o "/a b/out.dtbo" "/a b/in.dtso"');
    });
}
