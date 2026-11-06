import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { answer, command, refuse, type Outcome, type Session } from "../../../../interface/backend-interface";
import { project_root, run_shell } from "../../../shell";
import { read_settings } from "../../config/settings";
import { derive_build_files, derive_dtbo_path, load_workspace, type Workspace } from "../../config/workspace";
import { write_full_devicetree } from "../../full-devicetree";
import { substitute_command } from "../../utilities";
import type { BuildResponse } from "../../protocol/types";

/** dtc invocation that compiles the overlay, or the full devicetree; {dtc}/{input}/{output} are substituted. */
export const BUILD_COMMAND = "{dtc} -@ -I dts -O dtb -o {output} {input}";

/** The scratch file of the state directory the full devicetree is preprocessed into. */
const PREPROCESSED = "build.preprocessed.dts";

/** Run dtc on `input`; the refusal with its standard error when it fails. */
function compile(dtc: string, input: string, output: string): Outcome<never> | undefined {
    try {
        fs.mkdirSync(path.dirname(output), { recursive: true });
        execSync(substitute_command(BUILD_COMMAND, { dtc, input, output }), { stdio: "pipe" });
        return undefined;
    } catch (error: any) {
        const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
        return refuse(`Build failed:\n${stderr}`, { type: "tool-failed" });
    }
}

/**
 * Output `full`: write the base with the overlay applied (`write_full_devicetree`)
 * into the build folder and compile it into a `.dtb` next to it.
 */
function build_full(workspace: Workspace<"tools" | "base" | "overlay">, session: Session, source: string, binary: string): Outcome<BuildResponse> {
    const problem = write_full_devicetree(workspace, source, path.join(session.state_dir, PREPROCESSED));
    if (problem !== undefined) { return refuse(`Build failed: ${problem.message}`, { type: problem.type }); }
    return compile(workspace.tools.dtc, path.join(session.state_dir, PREPROCESSED), binary)
        ?? answer({ ok: true, message: "Compiled devicetree", severity: "info", path: binary, source } satisfies BuildResponse, `Build completed successfully\n\n  ${source}\n  ${binary}`);
}

/** `build-command` in place of dtc: run at the base of the project, its output on stderr. */
async function run_build_command(template: string, session: Session): Promise<Outcome<BuildResponse>> {
    const loaded = load_workspace(session, ["overlay_path"]);
    if (!loaded.ok) { return loaded.outcome; }
    const { overlay_path: workfile, settings } = loaded.workspace;
    const output = derive_build_files(workfile, settings.output, settings.build_dir).binary;
    const progress = session.progress(`Building ${workfile} with '${template}'`);
    const result = await run_shell(substitute_command(template, { workfile, output }), project_root(session), { line: text => { progress.line(text); }, signal: session.signal });
    progress.done();
    if (result.exit_code !== 0) {
        return refuse(`Build failed with exit code ${String(result.exit_code)}`, { type: "tool-failed" });
    }
    // The command is the user's: report the .dtbo (or .dtb) only when it wrote one where build would have.
    const built = fs.existsSync(output);
    return answer<BuildResponse>(
        { ok: true, message: `Built ${workfile} with '${template}'`, severity: "info", ...(built ? { path: output } : {}) },
        built ? `Build completed successfully\n\n  ${output}` : "Build completed successfully",
    );
}

export const build = command<Record<never, never>, BuildResponse>({
    docs: {
        brief: "Compile the overlay into a .dtbo, or a full .dtb",
        full: `Compiles the configured overlay file into a binary .dtbo in the build-dir
folder ('build' at the base of the project unless set), named after the
overlay (overlay.dtso -> overlay.dtbo). With build-command set, runs that
instead, at the base of the project.

With 'config output full', writes the base devicetree with the overlay applied
instead (build/overlay.dts: an #include of the base, then the overlay's nodes)
and compiles it into build/overlay.dtb, for boards that boot a full devicetree.`,
        examples: ["build", "--json build", "config build-command 'make overlay'"],
    },
    run(_arguments, _flags, session) {
        const template = read_settings(session.settings).build_command;
        if (template !== undefined && template !== "") { return run_build_command(template, session); }
        const loaded = load_workspace(session, ["tools", "base", "overlay"]);
        if (!loaded.ok) { return Promise.resolve(loaded.outcome); }
        const { workspace } = loaded;
        const input = workspace.overlay.path;
        const files = derive_build_files(input, workspace.settings.output, workspace.settings.build_dir);
        if (files.source !== undefined) { return Promise.resolve(build_full(workspace, session, files.source, files.binary)); }
        const output = files.binary;
        return Promise.resolve(compile(workspace.tools.dtc, input, output)
            ?? answer({ ok: true, message: "Compiled overlay", severity: "info", path: output } satisfies BuildResponse, `Build completed successfully\n\n  ${output}`));
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

    test("derive_build_files - the .dtbo, or with output full the .dts and .dtb, in the build folder", () => {
        expect(derive_build_files("/x/overlay.dtso", "overlay", "/p/build")).toEqual({ binary: "/p/build/overlay.dtbo" });
        expect(derive_build_files("/x/overlay.dtso", "full", "/p/build")).toEqual({ source: "/p/build/overlay.dts", binary: "/p/build/overlay.dtb" });
        // A .dts workfile in the build folder itself is never written over.
        expect(derive_build_files("/p/my.dts", "full", "/p")).toEqual({ source: "/p/my.dts.dts", binary: "/p/my.dts.dtb" });
    });

    test("BUILD_COMMAND - substitutes and quotes every placeholder", () => {
        expect(substitute_command(BUILD_COMMAND, { dtc: "/t/dtc", input: "/a b/in.dtso", output: "/a b/out.dtbo" }))
            .toBe('"/t/dtc" -@ -I dts -O dtb -o "/a b/out.dtbo" "/a b/in.dtso"');
    });
}
