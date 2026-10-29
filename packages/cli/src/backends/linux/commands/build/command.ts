import { execSync } from "node:child_process";

import { answer, command, refuse } from "../../../../interface/backend-interface";
import { derive_dtbo_path, load_workspace } from "../../config/workspace";
import { substitute_command } from "../../utilities";
import type { BuildResponse } from "../../protocol/types";

/** dtc invocation that compiles the overlay; {dtc}/{input}/{output} are substituted. */
export const BUILD_COMMAND = "{dtc} -@ -I dts -O dtb -o {output} {input}";

export const build = command<Record<never, never>, BuildResponse>({
    docs: {
        brief: "Compile the overlay into a .dtbo",
        full: `Compiles the configured overlay file into a binary .dtbo.
Output path is derived from the overlay (e.g. overlay.dtso -> overlay.dtbo).`,
    },
    run(_arguments, _flags, session) {
        const loaded = load_workspace(session, ["tools", "base", "overlay"]);
        if (!loaded.ok) { return Promise.resolve(loaded.outcome); }
        const { workspace } = loaded;
        const input = workspace.overlay.path;
        const output = derive_dtbo_path(input);
        const build_command = substitute_command(BUILD_COMMAND, { dtc: workspace.tools.dtc, input, output });
        try {
            execSync(build_command, { stdio: "pipe" });
        } catch (error: any) {
            const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
            return Promise.resolve(refuse(`Build failed:\n${stderr}`));
        }
        return Promise.resolve(answer({ ok: true, message: "Compiled overlay", severity: "info", path: output } satisfies BuildResponse, `Wrote ${output}`));
    },
});

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
