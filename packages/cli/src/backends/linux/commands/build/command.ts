import { execSync } from "node:child_process";
import fs from "node:fs";

import { answer, command, refuse, type Outcome, type Session } from "../../../../interface/backend-interface";
import { project_root, run_shell } from "../../../shell";
import { read_settings } from "../../config/settings";
import { derive_dtbo_path, load_workspace } from "../../config/workspace";
import { substitute_command } from "../../utilities";
import type { BuildResponse } from "../../protocol/types";

/** dtc invocation that compiles the overlay; {dtc}/{input}/{output} are substituted. */
export const BUILD_COMMAND = "{dtc} -@ -I dts -O dtb -o {output} {input}";

/** `build-command` in place of dtc: run at the base of the project, its output on stderr. */
async function run_build_command(template: string, session: Session): Promise<Outcome<BuildResponse>> {
    const loaded = load_workspace(session, ["overlay_path"]);
    if (!loaded.ok) { return loaded.outcome; }
    const { overlay_path: workfile, settings } = loaded.workspace;
    const output = derive_dtbo_path(workfile, settings.build_dir);
    const progress = session.progress(`Building ${workfile} with '${template}'`);
    const result = await run_shell(substitute_command(template, { workfile, output }), project_root(session), { line: text => { progress.line(text); }, signal: session.signal });
    progress.done();
    if (result.exit_code !== 0) {
        return refuse(`Build failed with exit code ${String(result.exit_code)}`);
    }
    // The command is the user's: report the .dtbo only when it wrote one where build would have.
    const built = fs.existsSync(output);
    return answer<BuildResponse>(
        { ok: true, message: `Built ${workfile} with '${template}'`, severity: "info", ...(built ? { path: output } : {}) },
        built ? `Build completed successfully\n\n  ${output}` : "Build completed successfully",
    );
}

export const build = command<Record<never, never>, BuildResponse>({
    docs: {
        brief: "Compile the overlay into a .dtbo",
        full: `Compiles the configured overlay file into a binary .dtbo in the build-dir
folder ('build' at the base of the project unless set), named after the
overlay (overlay.dtso -> overlay.dtbo). With build-command set, runs that
instead, at the base of the project.`,
        examples: ["build", "--json build", "config build-command 'make overlay'"],
    },
    run(_arguments, _flags, session) {
        const template = read_settings(session.settings).build_command;
        if (template !== undefined && template !== "") { return run_build_command(template, session); }
        const loaded = load_workspace(session, ["tools", "base", "overlay"]);
        if (!loaded.ok) { return Promise.resolve(loaded.outcome); }
        const { workspace } = loaded;
        const input = workspace.overlay.path;
        const output = derive_dtbo_path(input, workspace.settings.build_dir);
        const build_command = substitute_command(BUILD_COMMAND, { dtc: workspace.tools.dtc, input, output });
        try {
            fs.mkdirSync(workspace.settings.build_dir, { recursive: true });
            execSync(build_command, { stdio: "pipe" });
        } catch (error: any) {
            const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
            return Promise.resolve(refuse(`Build failed:\n${stderr}`));
        }
        return Promise.resolve(answer({ ok: true, message: "Compiled overlay", severity: "info", path: output } satisfies BuildResponse, `Build completed successfully\n\n  ${output}`));
    },
});

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("derive_dtbo_path - in the build folder, .dtso swapped for .dtbo", () => {
        expect(derive_dtbo_path("/x/overlay.dtso", "/p/build")).toBe("/p/build/overlay.dtbo");
    });

    test("derive_dtbo_path - .dtbo appended when the overlay is not a .dtso", () => {
        expect(derive_dtbo_path("/x/overlay", "/p/build")).toBe("/p/build/overlay.dtbo");
    });

    test("BUILD_COMMAND - substitutes and quotes every placeholder", () => {
        expect(substitute_command(BUILD_COMMAND, { dtc: "/t/dtc", input: "/a b/in.dtso", output: "/a b/out.dtbo" }))
            .toBe('"/t/dtc" -@ -I dts -O dtb -o "/a b/out.dtbo" "/a b/in.dtso"');
    });
}
