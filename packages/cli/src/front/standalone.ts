// The standalone binary (`yarn build:binary`, scripts/build-binary.mjs): a Node single executable
// application with the CLI bundled in one file, and as its assets the files an installed package
// has beside `dist/`: package.json, `bundled/` and `skills/`. Python runs the scripts of
// `bundled/linux/`, the GUI serves `bundled/gui/` and `skill install` copies `skills/`, so they
// must be files: the first run of a build writes them to a directory of the user's cache, one per
// build, and that directory is the package root of every run of that build.

import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sea from "node:sea";

/** The asset that lists the others: `{ key, files }`, `key` naming the build's files. */
export const MANIFEST_ASSET = "manifest.json";

export interface Manifest {
	/** The version and a hash of the files: the name of their directory in the cache. */
	key: string;
	/** The assets, by their path under the package root (`/`-separated). */
	files: string[];
}

/** Whether this process is the standalone binary. */
export function is_standalone(): boolean {
	return sea.isSea();
}

/** The user's cache directory: `$XDG_CACHE_HOME`, `~/.cache`, `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows. */
export function cache_home(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
	const xdg = environment["XDG_CACHE_HOME"];
	if (xdg !== undefined && path.isAbsolute(xdg)) { return xdg; }
	if (platform === "darwin") { return path.join(home, "Library", "Caches"); }
	const local = environment["LOCALAPPDATA"];
	if (platform === "win32" && local !== undefined && path.isAbsolute(local)) { return local; }
	return path.join(home, ".cache");
}

/**
 * The files of `manifest` under `<cache>/analog-attach/<key>`, written there unless they already
 * are. They are written to a temporary directory renamed into place, so a run never sees half of
 * them; of two first runs at once, the second one's rename fails and it takes the first one's.
 */
export function write_assets(cache: string, manifest: Manifest, read: (file: string) => ArrayBuffer): string {
	const root = path.join(cache, "analog-attach", manifest.key);
	if (fs.existsSync(root)) { return root; }
	const temporary = `${root}.${process.pid}.tmp`;
	fs.rmSync(temporary, { recursive: true, force: true });
	try {
		for (const file of manifest.files) {
			const target = path.join(temporary, ...file.split("/"));
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, new Uint8Array(read(file)));
		}
		fs.renameSync(temporary, root);
	} catch (error) {
		fs.rmSync(temporary, { recursive: true, force: true });
		if (!fs.existsSync(root)) { throw error; }
	}
	return root;
}

let standalone_root_cache: string | undefined;

/** The package root of the standalone binary: its assets, written out on the first call of a build's first run. */
export function standalone_root(): string {
	standalone_root_cache ??= write_assets(
		cache_home(),
		JSON.parse(sea.getAsset(MANIFEST_ASSET, "utf8")) as Manifest,
		file => sea.getAsset(file),
	);
	return standalone_root_cache;
}

if (import.meta.vitest) {
	const { describe, expect, test } = import.meta.vitest;

	describe("standalone", () => {
		test("cache_home - XDG_CACHE_HOME first, then the platform's", () => {
			expect(cache_home({ XDG_CACHE_HOME: "/x/cache" }, "linux", "/home/u")).toBe("/x/cache");
			expect(cache_home({ XDG_CACHE_HOME: "relative" }, "linux", "/home/u")).toBe(path.join("/home/u", ".cache"));
			expect(cache_home({}, "darwin", "/Users/u")).toBe(path.join("/Users/u", "Library", "Caches"));
			expect(cache_home({ LOCALAPPDATA: "/c/Local" }, "win32", "/c/u")).toBe("/c/Local");
		});

		test("write_assets - writes the files once, under the build's key", () => {
			const cache = fs.mkdtempSync(path.join(os.tmpdir(), "aa-standalone-"));
			try {
				const contents: Record<string, string> = { "package.json": "{}", "bundled/linux/a.py": "print(1)\n" };
				const read = (file: string): ArrayBuffer => new TextEncoder().encode(contents[file]).buffer as ArrayBuffer;
				const root = write_assets(cache, { key: "1.0.0-abc", files: Object.keys(contents) }, read);
				expect(root).toBe(path.join(cache, "analog-attach", "1.0.0-abc"));
				expect(fs.readFileSync(path.join(root, "bundled", "linux", "a.py"), "utf8")).toBe("print(1)\n");
				expect(fs.readdirSync(path.join(cache, "analog-attach"))).toEqual(["1.0.0-abc"]);

				const again = write_assets(cache, { key: "1.0.0-abc", files: Object.keys(contents) }, () => { throw new Error("read again"); });
				expect(again).toBe(root);
			} finally {
				fs.rmSync(cache, { recursive: true, force: true });
			}
		});
	});
}
