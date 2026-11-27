import * as fs from "node:fs";
import path from "node:path";

// The base DTSes this process has preprocessed (COM-097), kept for the next run of a long-lived
// process: the preprocessor runs again only when a file it read changed. Only with the default
// `AA_PREPROCESS_COMMAND` (DEFAULT_PREPROCESS_COMMAND: `-nostdinc -I "$AA_LINUX/include"`), where what
// cpp reads is known: each `#include` (and dtc's `/include/`), from the source down, in the
// folder of the file that includes it (for `"…"`), then the Linux tree's `include/`. An include
// is the file found, and, when that is under `include/`, the absence of the one beside the file
// that includes it, which cpp would take first. With another command, or an include that isn't
// found there (by a macro, `#include_next`), nothing is kept: the preprocessor runs on every run.

/** The most files one base may read for it to be kept. */
const MOST_FILES = 5000;

/** A file the preprocessor read (`exists`), or one it would have read first had it been there. */
interface Read {
	file: string;
	exists: boolean;
}

const kept = new Map<string, { reads: Read[]; stamp: string; text: string }>();

const is_file = (file: string): boolean => fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true;

/** The files the default command reads for `source`, with `include` the Linux tree's `include/`; undefined when that can't be told. */
export function included_files(source: string, include: string): Read[] | undefined {
	const reads: Read[] = [{ file: source, exists: true }];
	const seen = new Set([source]);
	const pending = [source];
	while (pending.length > 0) {
		const file = pending.pop()!;
		let text: string;
		try {
			text = fs.readFileSync(file, "utf8");
		} catch {
			return undefined;
		}
		if (/^\s*#\s*(include_next|import)\b/m.test(text) || /^\s*#\s*include\s+[^\s"<]/m.test(text)) { return undefined; }
		for (const match of text.matchAll(/^\s*(?:#\s*include\s*([<"])([^">\n]+)[">]|\/include\/\s*"([^"\n]+)")/gm)) {
			const name = match[2] ?? match[3]!;
			const beside = match[1] === "<" ? undefined : path.resolve(path.dirname(file), name);
			const in_tree = path.resolve(include, name);
			if (beside !== undefined && is_file(beside)) {
				reads.push({ file: beside, exists: true });
			} else if (is_file(in_tree)) {
				if (beside !== undefined) { reads.push({ file: beside, exists: false }); }
				reads.push({ file: in_tree, exists: true });
			} else {
				return undefined;
			}
			const included = reads.at(-1)!.file;
			if (!seen.has(included)) {
				seen.add(included);
				pending.push(included);
			}
			if (reads.length > MOST_FILES) { return undefined; }
		}
	}
	return reads;
}

/** Each file's size and mtime, `-` for one that isn't there; undefined when a file read is gone. */
function stamp_of(reads: readonly Read[]): string | undefined {
	const parts: string[] = [];
	for (const { file, exists } of reads) {
		const stat = fs.statSync(file, { throwIfNoEntry: false });
		if (exists && stat === undefined) { return undefined; }
		parts.push(stat === undefined ? "-" : `${String(stat.size)}:${String(stat.mtimeMs)}`);
	}
	return parts.join(",");
}

/** The kept preprocessor output for `key`, when every file it read is as it was (and `output`, the copy, is there). */
export function kept_preprocessed(key: string, output: string): string | undefined {
	const entry = kept.get(key);
	if (entry === undefined) { return undefined; }
	if (fs.existsSync(output) && stamp_of(entry.reads) === entry.stamp) { return entry.text; }
	kept.delete(key);
	return undefined;
}

/** Keep `text`, made from `source` by the default command with the Linux tree `linux`, when what it read can be told. */
export function keep_preprocessed(key: string, text: string, source: string, linux: string): void {
	const reads = included_files(source, path.join(linux, "include"));
	const stamp = reads === undefined ? undefined : stamp_of(reads);
	if (reads === undefined || stamp === undefined) {
		kept.delete(key);
		return;
	}
	kept.set(key, { reads, stamp, text });
}

/** Forget what was kept for `key` (its preprocessing failed, or it isn't the default command). */
export function forget_preprocessed(key: string): void {
	kept.delete(key);
}

if (import.meta.vitest) {
	const { test, expect, describe, beforeEach, afterEach } = import.meta.vitest;
	const os = await import("node:os");

	let root: string;
	beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "attach-preprocessed-"))); });
	afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
	const write = (relative: string, text: string): string => {
		const file = path.join(root, relative);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
		return file;
	};
	const include = (): string => path.join(root, "linux", "include");

	describe("included_files — what the default command reads", () => {
		test("the source, its includes by \"\" and <>, recursively", () => {
			const source = write("base.dts", "#include \"local.dtsi\"\n#include <dt-bindings/gpio.h>\n/dts-v1/;\n");
			write("local.dtsi", "/include/ \"more.dtsi\"\n");
			write("more.dtsi", "");
			write("linux/include/dt-bindings/gpio.h", "#include <dt-bindings/common.h>\n");
			write("linux/include/dt-bindings/common.h", "");
			const reads = included_files(source, include());
			expect(reads?.map(read => path.relative(root, read.file)).sort()).toEqual([
				"base.dts", "linux/include/dt-bindings/common.h", "linux/include/dt-bindings/gpio.h", "local.dtsi", "more.dtsi",
			]);
			expect(reads?.every(read => read.exists)).toBe(true);
		});

		test("a \"\" include found in the tree records the file beside, which would shadow it", () => {
			const source = write("base.dts", "#include \"dt-bindings/gpio.h\"\n");
			write("linux/include/dt-bindings/gpio.h", "");
			expect(included_files(source, include())).toEqual([
				{ file: source, exists: true },
				{ file: path.join(root, "dt-bindings", "gpio.h"), exists: false },
				{ file: path.join(include(), "dt-bindings", "gpio.h"), exists: true },
			]);
		});

		test("nothing, when it can't be told", () => {
			const source = write("base.dts", "#include HEADER\n");
			expect(included_files(source, include())).toBeUndefined();
			write("base.dts", "#include <stdio.h>\n");
			expect(included_files(source, include())).toBeUndefined();
			write("base.dts", "#include_next <x.h>\n");
			expect(included_files(source, include())).toBeUndefined();
		});
	});

	describe("kept_preprocessed — the output while what it read is unchanged", () => {
		test("kept until an include changes, appears where it would shadow, or the copy is gone", () => {
			const source = write("base.dts", "#include \"a.dtsi\"\n");
			const included = write("linux/include/a.dtsi", "/ { };\n");
			const output = write("out.dts", "text");
			const linux = path.join(root, "linux");
			keep_preprocessed("key", "text", source, linux);
			expect(kept_preprocessed("key", output)).toBe("text");

			fs.writeFileSync(included, "/ { x; };\n");
			expect(kept_preprocessed("key", output)).toBeUndefined();

			keep_preprocessed("key", "text", source, linux);
			write("a.dtsi", "");
			expect(kept_preprocessed("key", output)).toBeUndefined();

			keep_preprocessed("key", "text", source, linux);
			fs.rmSync(output);
			expect(kept_preprocessed("key", output)).toBeUndefined();
		});

		test("not kept when what it read can't be told", () => {
			const source = write("base.dts", "#include MACRO\n");
			const output = write("out.dts", "text");
			keep_preprocessed("key", "text", source, path.join(root, "linux"));
			expect(kept_preprocessed("key", output)).toBeUndefined();
		});
	});
}
