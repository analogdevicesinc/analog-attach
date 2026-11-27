// What `build` writes and the scripts `build` and `deploy` run by default, named from the
// settings: shared by the workspace loader and `scripts.ts`, neither importing the other for it.

import os from "node:os";
import path from "node:path";

import type { Output } from "./settings";

/** The commands that run a script of the project's, and the script each runs. */
export const SCRIPTS = { build: "aa_build.sh", deploy: "aa_deploy.sh" } as const;
export type ScriptCommand = keyof typeof SCRIPTS;

/** Where `build` writes the overlay's `.dtbo`: in `build_directory`, the file named after the overlay (`overlay.dtso` → `overlay.dtbo`). */
export function derive_dtbo_path(overlay: string, build_directory: string): string {
	const name = path.basename(overlay);
	return path.join(build_directory, name.endsWith(".dtso") ? `${name.slice(0, -".dtso".length)}.dtbo` : `${name}.dtbo`);
}

/** The files `build` writes from the workfile: the full devicetree source (output `devicetree`), and the compiled one. */
export interface BuildFiles {
	source?: string;
	binary: string;
}

/**
 * The files `build` writes in `build_directory`, named after the overlay: `overlay.dtso` gives `overlay.dtbo`, or with
 * output `devicetree` `overlay.dts` and `overlay.dtb`; another name gets the extensions appended, so a `.dts` workfile is
 * never written over.
 */
export function derive_build_files(overlay: string, output: Output, build_directory: string): BuildFiles {
	if (output === "overlay") { return { binary: derive_dtbo_path(overlay, build_directory) }; }
	const name = path.basename(overlay);
	const stem = path.join(build_directory, name.endsWith(".dtso") ? name.slice(0, -".dtso".length) : name);
	return { source: `${stem}.dts`, binary: `${stem}.dtb` };
}

/** The `build-dir` setting as a folder: relative to the project root unless absolute, `~` the home directory. */
export function build_folder(setting: string, root: string): string {
	const expanded = setting === "~" || setting.startsWith("~/") ? path.join(os.homedir(), setting.slice(1)) : setting;
	return path.resolve(root, expanded);
}
