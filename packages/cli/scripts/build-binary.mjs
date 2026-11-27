#!/usr/bin/env node
// `yarn build:binary [--arch <arch>]...`: the CLI and the GUI as one executable,
// `dist-binary/<platform>-<arch>/analog-attach`, a Node single executable application
// (node --build-sea) for this platform and each architecture asked for (nodejs.org's names: x64,
// arm64…), this Node's by default. It runs after `yarn build`, which writes `bundled/`:
//
// 1. the built CLI bundled in one ES module, its npm packages included (a SEA runs one script);
// 2. as assets, the files an installed package has beside `dist/` (package.json, `bundled/`,
//    `skills/`) and a manifest of them, which `src/front/standalone.ts` writes to the user's
//    cache on the first run of a build;
// 3. the Node the binary is made of: for this Node's architecture $ANALOG_ATTACH_SEA_NODE, else the
//    official build of this Node's version for the architecture from nodejs.org, downloaded once to
//    the user's cache and checked against its SHASUMS256.txt. Not the Node that runs this script: a
//    distribution's (Arch's, Homebrew's) links the system's OpenSSL, ICU, Abseil, libuv…, so its
//    binary runs only where those very versions are. The official one has them built in;
// 4. node --build-sea, run by the Node of this architecture, onto the Node of the target's (the
//    blob is the same for every architecture: no snapshot, no code cache), then, on Linux, the
//    segments it added moved to the Node's alignment (for the 16 KiB and 64 KiB page kernels) and
//    a check with readelf that the binary links nothing but the C and C++ runtimes, and on macOS an
//    ad-hoc signature.
//
// The tools the backends run (dtc, dt-schema, CMake, claude) aren't in it: they are the system's.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "tsup";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "dist-binary");
const PROGRAM = process.platform === "win32" ? "analog-attach.exe" : "analog-attach";
const ASSET_DIRECTORIES = ["bundled", "skills"];
const SKIPPED = new Set(["__pycache__", ".DS_Store"]);
/**
 * What a Linux binary may link: the C and C++ runtimes, which every distribution has, and GCC's
 * libatomic, which nodejs.org's Node links and minimal images (Debian's slim ones) lack: the README
 * names it.
 */
const SYSTEM_LIBRARIES = /^(ld-linux[^ ]*|libc|libm|libdl|libpthread|librt|libstdc\+\+|libgcc_s|libatomic)\.so/;

function fail(message) {
	console.error(`build-binary: ${message}`);
	process.exit(1);
}

/** The user's cache directory, as `src/front/standalone.ts` finds it. */
function cache_home() {
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg !== undefined && path.isAbsolute(xdg)) { return xdg; }
	if (process.platform === "darwin") { return path.join(os.homedir(), "Library", "Caches"); }
	const local = process.env.LOCALAPPDATA;
	if (process.platform === "win32" && local !== undefined && path.isAbsolute(local)) { return local; }
	return path.join(os.homedir(), ".cache");
}

async function download(url) {
	const response = await fetch(url);
	if (!response.ok) { fail(`${url}: ${response.status} ${response.statusText}`); }
	return Buffer.from(await response.arrayBuffer());
}

/**
 * The official Node of this version for this platform and `arch`, from nodejs.org: downloaded once
 * to `<cache>/analog-attach/node/<name>/`, its archive checked against the release's SHASUMS256.txt.
 */
async function official_node(arch) {
	const version = `v${process.versions.node}`;
	const system = { linux: "linux", darwin: "darwin", win32: "win" }[process.platform];
	if (system === undefined) { fail(`nodejs.org has no Node for ${process.platform}: set ANALOG_ATTACH_SEA_NODE to the Node to use`); }
	const name = `node-${version}-${system}-${arch}`;
	const archive = `${name}.${system === "win" ? "zip" : "tar.gz"}`;
	const directory = path.join(cache_home(), "analog-attach", "node");
	const node = path.join(directory, name, ...(system === "win" ? ["node.exe"] : ["bin", "node"]));
	if (fs.existsSync(node)) { return node; }

	const base = `https://nodejs.org/dist/${version}`;
	console.log(`build-binary: downloading ${base}/${archive}`);
	const sums_bytes = await download(`${base}/SHASUMS256.txt`);
	const sums = sums_bytes.toString("utf8");
	const expected = sums.split("\n").map(line => line.trim().split(/\s+/)).find(([, file]) => file === archive)?.[0];
	if (expected === undefined) { fail(`${base}/SHASUMS256.txt has no ${archive}`); }
	const bytes = await download(`${base}/${archive}`);
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expected) { fail(`${archive}: SHA-256 ${actual}, but SHASUMS256.txt says ${expected}`); }

	// Unpacked beside the cache, then renamed into it, so a broken download leaves nothing there.
	fs.mkdirSync(directory, { recursive: true });
	const temporary = fs.mkdtempSync(path.join(directory, ".download-"));
	try {
		fs.writeFileSync(path.join(temporary, archive), bytes);
		// tar unpacks a zip too where it is bsdtar (Windows, macOS).
		const unpacked = spawnSync("tar", ["-xf", archive], { cwd: temporary, stdio: "inherit" });
		if (unpacked.status !== 0) { fail(`tar couldn't unpack ${archive}`); }
		fs.renameSync(path.join(temporary, name), path.join(directory, name));
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
	return node;
}

/**
 * The shared libraries a Linux binary links that aren't the C or C++ runtimes, and the newest glibc
 * it needs, read from its ELF headers (readelf, which reads any architecture's; ldd runs only this
 * one's): its NEEDED entries and its version needs.
 */
function linked_libraries(binary) {
	const read = spawnSync("readelf", ["--dynamic", "--version-info", "--wide", binary], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
	if (read.error !== undefined) { fail(`readelf couldn't run (${read.error.message}): install binutils`); }
	if (read.status !== 0) { fail(`readelf ${binary} failed: ${read.stderr}`); }
	const libraries = [...read.stdout.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/g)].map(match => match[1]);
	const needs = read.stdout.split("Version needs section")[1] ?? "";
	const glibc = [...needs.matchAll(/Name: GLIBC_(\d+)\.(\d+)/g)].map(match => [Number(match[1]), Number(match[2])])
		.sort(([a_major, a_minor], [b_major, b_minor]) => a_major - b_major || a_minor - b_minor).at(-1);
	return { others: libraries.filter(library => !SYSTEM_LIBRARIES.test(library)), glibc: glibc?.join(".") };
}

/**
 * Moves the segments --build-sea adds to a Linux binary to the alignment of the Node's own, so the
 * binary runs on every page size its Node runs on. LIEF, which --build-sea injects with, aligns the
 * segments it adds (the program headers', the blob's) at 4 KiB whatever the binary's are. nodejs.org's
 * arm64 Node aligns its own at 64 KiB, for the kernels with 16 KiB or 64 KiB pages (a Raspberry Pi
 * 5's), where an added segment then shares a page with the writable data before it, or has an
 * address and a file offset that differ by part of a page: the kernel can't map it and kills the
 * binary with SIGSEGV before it starts. Each such segment gets a new address: the first after the
 * segments before it, in pages of the binary's alignment, that is congruent to its file offset.
 * The program headers and sections inside it follow it. Nothing else holds these addresses: Node
 * finds the blob by the PT_NOTE program headers. A 64-bit little-endian ELF only (x64, arm64). 32-bit
 * ARM's kernels have 4 KiB pages.
 */
function align_added_segments(binary) {
	const PT_LOAD = 1;
	const descriptor = fs.openSync(binary, "r+");
	try {
		const read = (position, length) => {
			const buffer = Buffer.alloc(length);
			fs.readSync(descriptor, buffer, 0, length, position);
			return buffer;
		};
		const header = read(0, 64);
		if (header.readUInt32BE(0) !== 0x7F_45_4C_46 || header[4] !== 2 || header[5] !== 1) { return; }
		const ph_offset = Number(header.readBigUInt64LE(0x20));
		const sh_offset = Number(header.readBigUInt64LE(0x28));
		const [ph_size, ph_count, sh_size, sh_count] = [0x36, 0x38, 0x3A, 0x3C].map(at => header.readUInt16LE(at));
		const program_headers = read(ph_offset, ph_size * ph_count);
		const sections = read(sh_offset, sh_size * sh_count);
		const segments = Array.from({ length: ph_count }, (_, index) => {
			const at = index * ph_size;
			return {
				at,
				type: program_headers.readUInt32LE(at),
				offset: program_headers.readBigUInt64LE(at + 8),
				vaddr: program_headers.readBigUInt64LE(at + 16),
				memsz: program_headers.readBigUInt64LE(at + 40),
				align: program_headers.readBigUInt64LE(at + 48),
			};
		});
		const loads = segments.filter(segment => segment.type === PT_LOAD).sort((a, b) => Number(a.vaddr - b.vaddr));
		let align = 1n;
		for (const load of loads) {
			if (load.align > align) { align = load.align; }
		}
		const round_up = value => (value + align - 1n) / align * align;
		const moves = [];
		let end = 0n;
		for (const load of loads) {
			if (load.align < align) {
				const vaddr = round_up(end) + load.offset % align;
				moves.push({ from: load.vaddr, size: load.memsz, delta: vaddr - load.vaddr });
				load.vaddr = vaddr;
				load.align = align;
			}
			end = load.vaddr + load.memsz;
		}
		if (moves.length === 0) { return; }
		for (const [index, load] of loads.entries()) {
			const next = loads[index + 1];
			if (load.vaddr % align !== load.offset % align || (next !== undefined && round_up(load.vaddr + load.memsz) > next.vaddr / align * align)) {
				fail(`${binary}: its segments can't all be aligned at ${align} bytes`);
			}
		}
		const moved = address => moves.find(move => address >= move.from && address < move.from + move.size);
		for (const segment of segments) {
			// A moved PT_LOAD has its new address already; another segment follows the PT_LOAD it is in.
			const old_vaddr = program_headers.readBigUInt64LE(segment.at + 16);
			const delta = segment.type === PT_LOAD ? segment.vaddr - old_vaddr : moved(old_vaddr)?.delta ?? 0n;
			if (delta === 0n) { continue; }
			program_headers.writeBigUInt64LE(old_vaddr + delta, segment.at + 16);
			program_headers.writeBigUInt64LE(program_headers.readBigUInt64LE(segment.at + 24) + delta, segment.at + 24);
			if (segment.type === PT_LOAD) { program_headers.writeBigUInt64LE(segment.align, segment.at + 48); }
		}
		for (let at = 0; at < sections.length; at += sh_size) {
			const address = sections.readBigUInt64LE(at + 16);
			const move = address === 0n ? undefined : moved(address);
			if (move !== undefined) { sections.writeBigUInt64LE(address + move.delta, at + 16); }
		}
		fs.writeSync(descriptor, program_headers, 0, program_headers.length, ph_offset);
		fs.writeSync(descriptor, sections, 0, sections.length, sh_offset);
	} finally {
		fs.closeSync(descriptor);
	}
}

/** The files under `directory`, `/`-separated and relative to the package root, sorted. */
function files_under(directory) {
	return fs.readdirSync(path.join(root, directory), { withFileTypes: true, recursive: true })
		.filter(entry => entry.isFile() && !entry.parentPath.split(path.sep).some(part => SKIPPED.has(part)) && !SKIPPED.has(entry.name))
		.map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
		.sort();
}

for (const needed of ["dist/cli.js", "bundled/gui/index.html", "bundled/linux/dt-mk-schema.py"]) {
	if (!fs.existsSync(path.join(root, needed))) { fail(`${needed} is missing: run 'yarn build' first`); }
}
let arches;
try {
	const { values } = parseArgs({ options: { arch: { type: "string", multiple: true } } });
	arches = [...new Set((values.arch ?? [process.arch]).flatMap(value => value.split(",")).map(arch => arch.trim()).filter(arch => arch !== ""))];
} catch (error) {
	fail(`${error.message}; usage: yarn build:binary [--arch <arch>]...`);
}
// The bundle, the manifest and the SEA configurations, removed at the end.
const work = path.join(out, ".build");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

// 1. One module, every package in it but Node's own. It bundles the built `dist/cli.js`, not the
// sources: there the inline tests are gone, whose `await import(...)` in `if (import.meta.vitest)`
// would make their modules async, and an async module in an import cycle never finishes loading
// once the modules are one file. The banner gives the CommonJS packages bundled in an ES module
// the `require` they call.
const main = path.join(work, "cli.mjs");
await build({
	config: false,
	entry: { cli: path.join(root, "dist/cli.js") },
	outDir: work,
	outExtension: () => ({ js: ".mjs" }),
	format: ["esm"],
	platform: "node",
	splitting: false,
	noExternal: [/.*/],
	banner: { js: "import { createRequire as __create_require } from \"node:module\"; const require = __create_require(import.meta.url);" },
	treeshake: true,
	removeNodeProtocol: false,
	silent: true,
});
if (!fs.existsSync(main)) { fail(`the bundle ${main} wasn't written`); }

// 2. The assets and their manifest; the key changes with any of them.
const files = ["package.json", ...ASSET_DIRECTORIES.flatMap(directory => files_under(directory))];
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const hash = createHash("sha256");
for (const file of files) { hash.update(`${file}\0`).update(fs.readFileSync(path.join(root, file))).update("\0"); }
const manifest = path.join(work, "manifest.json");
fs.writeFileSync(manifest, JSON.stringify({ key: `${version}-${hash.digest("hex").slice(0, 16)}`, files }));

// 3. The Node that runs --build-sea, this architecture's.
const host_node = process.env.ANALOG_ATTACH_SEA_NODE || await official_node(process.arch);

for (const arch of arches) {
	// The Node the binary is made of.
	const sea_node = arch === process.arch ? host_node : await official_node(arch);
	const target = `${process.platform}-${arch}`;
	const directory = path.join(out, target);
	const program = path.join(directory, PROGRAM);
	fs.rmSync(directory, { recursive: true, force: true });
	fs.mkdirSync(directory, { recursive: true });

	// 4. The executable.
	const config = path.join(work, `sea-config-${target}.json`);
	fs.writeFileSync(config, JSON.stringify({
		main,
		mainFormat: "module",
		executable: sea_node,
		output: program,
		disableExperimentalSEAWarning: true,
		useSnapshot: false,
		useCodeCache: false,
		assets: { "manifest.json": manifest, ...Object.fromEntries(files.map(file => [file, path.join(root, file)])) },
	}, undefined, "\t"));
	const sea = spawnSync(host_node, ["--build-sea", config], { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" });
	if (sea.status !== 0) {
		process.stderr.write(sea.stderr ?? "");
		fail(`${host_node} --build-sea failed (it needs a Node that has --build-sea, as Node 26 does)`);
	}
	let glibc;
	if (process.platform === "linux") {
		align_added_segments(program);
		const linked = linked_libraries(program);
		if (linked.others.length > 0) {
			const hint = process.env.ANALOG_ATTACH_SEA_NODE ? ` ${sea_node} is likely a distribution's Node: leave ANALOG_ATTACH_SEA_NODE unset, for nodejs.org's.` : "";
			fs.rmSync(program);
			fail(`${program} links ${linked.others.join(", ")}, so it would run only where those very versions are installed.${hint}`);
		}
		glibc = linked.glibc;
	}
	if (process.platform === "darwin") {
		const signed = spawnSync("codesign", ["--sign", "-", program], { stdio: "inherit" });
		if (signed.status !== 0) { fail(`codesign --sign - ${program} failed`); }
	}
	const needs = glibc === undefined ? "" : `, needs glibc ${glibc} or later`;
	console.log(`${path.relative(process.cwd(), program)}: analog-attach ${version} for ${target}${needs}, ${Math.round(fs.statSync(program).size / 1e6)} MB, ${files.length} files`);
}
fs.rmSync(work, { recursive: true, force: true });
