/**
 * What a generated CAPI application is built from, worked out from the workfile and the
 * module graph so the templates only lay it out. Everything here is something a CAPI app
 * declares by hand today - capi-noos/projects/eval-adxl355-pmdz/basic is the reference:
 *
 *   platform  the platform module the board belongs to (capi-maxim), and its PLATFORM id
 *   board     BOARD and TARGET, the way capi/sdk/tools/generate_presets.py derives them
 *   drivers   each driver a node comes from: its Kconfig symbol and link target
 *   modules   the module roots the app depends on (platform, driver collections, packages)
 *   kconfig   project.conf: the platform interfaces used, the console, the drivers
 *   headers   what the generated C must include
 *   externs   the board peripherals referenced, to declare in the app's own parameters.h
 */

import fs from "node:fs";
import path from "node:path";

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import { board_externs } from "../registry/bsp";
import { find_board } from "../registry/platforms";
import { IIO_GROUP } from "../registry/drivers";
import { get_registry, resolve_entry } from "../registry/registry";
import type { ModuleInfo } from "../registry/types";
import type { Workfile } from "../workfile_handler/types";

/** The platform interfaces the console needs: a UART for stdio, and the IRQs it runs on. */
const CONSOLE_KCONFIG = ["UART", "IRQ"];

/** A module the app depends on, as its module.yml `depends:` entry needs it. */
export interface CapiDependency {
	name: string,
	/** `CAPI_<NAME>_PATH`: the variable the build reads the module's location from. */
	env_override: string,
	/** Where it is checked out on this machine. */
	path: string,
}

export interface CapiDriver {
	name: string,
	kconfig?: string,
	/** CMake target: capi::driver::<name>. */
	link: string,
}

export interface CapiExtern {
	symbol: string,
	/** The C struct type, without `struct`. */
	type: string,
}

export interface CapiProject {
	platform: { name: string, id: string },
	board: { name: string, target: string },
	drivers: CapiDriver[],
	/** Link targets of the packages the drivers build against (capi::util). */
	packages: string[],
	dependencies: CapiDependency[],
	/** The driver collections among them (capi-noos): built as subdirectories, with their Kconfig. */
	collections: CapiDependency[],
	/** Middleware among them (capi-iio): built as subdirectories too. */
	middleware: CapiDependency[],
	kconfig: string[],
	headers: string[],
	externs: CapiExtern[],
	/** The board UART stdio is brought up on, when the board declares exactly one. */
	console?: CapiExtern,
}

/** `capi-maxim` -> `maxim`, as a PLATFORM / link-target name. */
function short_name(module: string): string {
	return module.replace(/^capi-/, "");
}

function dependency(module: ModuleInfo): CapiDependency {
	return {
		name: module.name,
		env_override: `${module.name.toUpperCase().replaceAll("-", "_")}_PATH`,
		path: module.path,
	};
}

/** The `config <SYMBOL>` names a module's Kconfig defines. Empty when it has none. */
function kconfig_symbols(module: ModuleInfo): Set<string> {
	const file = path.join(module.path, "Kconfig");
	if (!fs.existsSync(file)) {
		return new Set();
	}
	const text = fs.readFileSync(file, "utf8");
	return new Set([...text.matchAll(/^\s*(?:menu)?config\s+(\w+)/gm)].map(match => match[1] ?? ""));
}

export function capi_project(workfile: Workfile): Result<CapiProject> {
	if (workfile.board === undefined) {
		return error("A CAPI application is built for a board, and the workfile names none");
	}
	const board = find_board(workfile.board);
	if (!board.ok) {
		return board;
	}
	const registry = get_registry();
	if (!registry.ok) {
		return registry;
	}
	const modules = registry.value.modules;

	const platform = modules.find(module => module.type === "platform" && module.boards?.includes(board.value.name));
	if (platform === undefined) {
		return error(`No configured platform declares board '${board.value.name}'`);
	}

	// generate_presets.py: the board's mcu with its package/temperature suffix stripped.
	const target = (board.value.soc ?? "").replace(/[a-zA-Z]+$/, "");

	// Every node's ruleset tells which module it comes from, and under which group.
	const used = Object.values(workfile.symbols).flatMap(node => {
		const entry = resolve_entry(node.$symbol);
		return entry.ok ? [entry.value] : [];
	});

	const driver_modules = [...new Map(used
		.filter(entry => entry.module.type === "driver")
		.map(entry => [entry.module.name, entry.module])).values()]
		.sort((a, b) => a.name.localeCompare(b.name));
	const drivers = driver_modules.map(module => ({
		name: module.name,
		...(module.build?.kconfig === undefined ? {} : { kconfig: module.build.kconfig }),
		link: `capi::driver::${module.name}`,
	}));

	// The collections the drivers live in (capi-noos), and the packages they build against.
	const collections = modules.filter(module => module.type === "driver_collection"
		&& driver_modules.some(driver => driver.path.startsWith(module.path + path.sep)));
	const package_names = [...new Set(driver_modules.flatMap(module => module.packages ?? []))].sort();
	const package_modules = package_names.flatMap(name => modules.filter(module => module.name === name));

	// Served over IIO: a node from a driver's `iio` group brings in capi-iio, the middleware
	// that provides the iio interface, and each such driver's own <KCONFIG>_IIO symbol.
	const iio_drivers = driver_modules.filter(module => used.some(entry => entry.module.path === module.path && entry.group === IIO_GROUP));
	const iio = iio_drivers.length === 0
		? []
		: modules.filter(module => module.type === "middleware" && module.provides_interfaces?.includes("iio") === true);
	if (iio_drivers.length > 0 && iio.length === 0) {
		return error(`${iio_drivers.map(module => module.name).join(", ")} is served over IIO, which needs capi-iio: add it to module_paths`);
	}
	const iio_kconfig = iio_drivers.flatMap(module => {
		const symbol = module.build?.kconfig === undefined ? undefined : `${module.build.kconfig}_IIO`;
		return symbol !== undefined && kconfig_symbols(module).has(symbol) ? [symbol] : [];
	});

	// project.conf: the platform interfaces the nodes use (a capi group named like one of the
	// platform's own Kconfig symbols), the console's, and each driver's own symbol.
	const platform_symbols = kconfig_symbols(platform);
	const interfaces = used
		.filter(entry => entry.module.type !== "driver")
		.map(entry => entry.group.toUpperCase())
		.filter(symbol => platform_symbols.has(symbol));
	const kconfig = [...new Set([
		...CONSOLE_KCONFIG.filter(symbol => platform_symbols.has(symbol)),
		...interfaces,
		...drivers.flatMap(driver => (driver.kconfig === undefined ? [] : [driver.kconfig])),
		...iio_kconfig,
	])].sort();

	// Headers: capi's generic header per group (capi_spi.h), each driver's own header and
	// its externs' headers, and what main.c itself calls (the platform and the console).
	const headers = new Set<string>(["capi_platform.h", "capi_uart.h"]);
	for (const entry of used) {
		if (entry.module.type === "driver") {
			if (fs.existsSync(path.join(entry.module.path, "inc", `${entry.module.name}.h`))) {
				headers.add(`${entry.module.name}.h`);
			}
			continue;
		}
		if (fs.existsSync(path.join(entry.module.path, "inc", `capi_${entry.group}.h`))) {
			headers.add(`capi_${entry.group}.h`);
		}
	}
	for (const node of Object.values(workfile.symbols)) {
		if ((node._t === "RulesetExtern" || node._t === "RulesetStruct") && node.$header !== undefined) {
			headers.add(path.basename(node.$header));
		}
	}
	if (iio.length > 0) {
		headers.add("capi_iio_app.h");
		headers.add("capi_util.h");
	}

	// The board peripherals the workfile references, to declare `extern` in parameters.h.
	const board_symbols = board_externs(board.value.name);
	if (!board_symbols.ok) {
		return board_symbols;
	}
	const of_board = new Map(board_symbols.value.externs.map(extern => [extern.$symbol, extern.$provides]));
	const externs = Object.values(workfile.symbols)
		.flatMap(node => (node._t === "RulesetExtern" && of_board.has(node.$symbol)
			? [{ symbol: node.$symbol, type: of_board.get(node.$symbol) ?? "" }]
			: []))
		.sort((a, b) => a.symbol.localeCompare(b.symbol));

	const uart_type = registry.value.bsp_kinds.get("uart");
	const uarts = board_symbols.value.externs.filter(extern => extern.$provides === uart_type);
	const [only_uart, ...more_uarts] = uarts;
	const console = only_uart !== undefined && more_uarts.length === 0
		? { symbol: only_uart.$symbol, type: only_uart.$provides }
		: undefined;
	if (console !== undefined && !externs.some(extern => extern.symbol === console.symbol)) {
		externs.push(console);
	}

	return ok({
		platform: { name: platform.name, id: short_name(platform.name) },
		board: { name: board.value.name, target },
		drivers,
		packages: [
			...package_names.map(name => `capi::${short_name(name)}`),
			...iio.map(module => `capi::middleware::${short_name(module.name)}`),
		],
		dependencies: [platform, ...collections, ...iio, ...package_modules].map(module => dependency(module)),
		collections: collections.map(module => dependency(module)),
		middleware: iio.map(module => dependency(module)),
		kconfig,
		headers: [...headers].sort(),
		externs,
		...(console === undefined ? {} : { console }),
	});
}
