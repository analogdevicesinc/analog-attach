/*
 * One-shot migration: derive the `$config:` Kconfig symbol list for every ruleset
 * from its existing `$sources` file lists, and insert it into the YAML in place.
 *
 * Run it (from the repo root, no extra dev dependency needed):
 *
 *   node_modules/.bin/esbuild packages/attach-no-os-lib/scripts/sources_to_config.ts \
 *       --bundle --platform=node --format=cjs \
 *     | node - <no-OS-path> [--write]
 *
 * Without --write it only prints the report, which is the point: the report is the
 * reviewable artifact. Nothing here is used at generate time — codegen only ever
 * reads the `$config:` key this writes, so no mapping rule leaks into codegen.
 *
 * Re-runnable: a `$config:` block that is already there is recomputed and replaced,
 * not skipped. So the rules below are the single description of what every ruleset
 * enables, and a rule that is added later reaches the files that were written before
 * it existed.
 *
 * ── Why the mapping is trustworthy ──────────────────────────────────────────────
 *
 * Two ground truths, never a naming guess:
 *
 *   1. `no_os_sources_ifdef(CONFIG_<SYM> <file>)` in no-OS's own CMakeLists.txt is
 *      the authoritative `.c file -> Kconfig symbol` mapping. Guessing the symbol
 *      from the directory name does NOT work: drivers/eeprom yields EEPROM_DRIVERS,
 *      not EEPROM.
 *   2. `include/no_os_<cap>.h` and `drivers/api/no_os_<cap>.c` both map to the
 *      root-Kconfig generic symbol `<CAP>`. Mapping the HEADER too (not just the .c)
 *      is deliberate: several core rulesets list only the header and omit the .c
 *      (no_os_i2c/uart/pwm/dma), so a .c-only rule would silently drop CONFIG_I2C,
 *      CONFIG_UART, CONFIG_PWM and CONFIG_DMA. Taking the union of the two
 *      reproduces exactly the set of API modules the deleted Make build linked,
 *      which is the behaviour we are preserving.
 *
 * A ruleset owns its enclosing `if <PARENT>` symbols as well as its leaf, because
 * Kconfig `select` is forward-propagating but `depends on` is a constraint that is
 * never auto-satisfied: with only CONFIG_ACCEL_ADXL355=y and no CONFIG_ACCEL=y the
 * leaf is capped at n, adxl355.c is never compiled, and it fails late as a link
 * error on adxl355_init. `select`ed symbols are deliberately NOT listed - Kconfig
 * closes those itself.
 *
 * `$sources.platform` and `$sources.sdk` map to nothing: platform driver sources
 * come from the board defconfig (board_configs/<platform>/<board>_defconfig), and
 * SDK headers are not gated by Kconfig at all.
 *
 * ── platform_ops own their interface symbol ─────────────────────────────────────
 *
 * A platform_ops ruleset exists to plug a vendor driver into one no-OS interface,
 * named by its `$capability`, and `drivers/api/no_os_<cap>.c` is gated on the
 * matching generic symbol. So the ops file enables it, whether or not its `$sources`
 * happened to list that API file. Without this rule the symbol only appeared when
 * something else in the workfile pulled it in - which is why max32655 built its
 * maxim_irq.c against a maxim_uart.c that CONFIG_UART had left out of the build, and
 * failed at link on `uart_irq_state`.
 */

import fs from "node:fs";
import path from "node:path";

/*
 * `$capability` -> the generic Kconfig symbol that gates drivers/api/no_os_<x>.c.
 * Every value is uppercase-identical to the capability except gpio_irq, which has no
 * generic symbol of its own: a GPIO interrupt controller is an IRQ controller, and
 * maxim_gpio_irq.c calls only the no_os_irq API.
 */
const CAPABILITY_SYMBOLS: Record<string, string> = {
	dma: "DMA",
	gpio: "GPIO",
	gpio_irq: "IRQ",
	i2c: "I2C",
	i3c: "I3C",
	irq: "IRQ",
	pwm: "PWM",
	spi: "SPI",
	tdm: "TDM",
	timer: "TIMER",
	trng: "TRNG",
	uart: "UART",
};

/*
 * Couplings between two vendor drivers, which no rule can see: they are C-level
 * references between files that Kconfig gates independently, so the linker is the
 * only thing that notices. Each entry needs evidence in the comment, and the pattern
 * is matched against the ruleset path relative to schemas/.
 *
 * These belong here rather than in the YAML by hand so that the reason survives, and
 * so a re-run cannot drop them.
 */
const CROSS_DRIVER_SYMBOLS: { pattern: RegExp, symbols: string[], why: string }[] = [
	{
		/* Every maxim target, all five of them. */
		pattern: /^platforms\/maxim\/[^/]+\/platform_ops\/irq_ops\.yaml$/,
		symbols: ["UART"],
		why: "maxim_irq.c externs uart_irq_state and is_callback, both defined in maxim_uart.c, "
			+ "which drivers/platform/maxim/CMakeLists.txt gates on CONFIG_UART_MAXIM (depends on UART)",
	},
];

type KconfigSymbol = {
	name: string,
	file: string,
	/* Enclosing `if <SYM>` scope, outermost first. These are real depends-on edges. */
	scope: string[],
	/* Symbols named by `depends on` lines inside the config block. */
	depends: string[],
};

function walk(dir: string, predicate: (file: string) => boolean, skip: Set<string>): string[] {
	const found: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (skip.has(entry.name)) {
			continue;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...walk(full, predicate, skip));
		} else if (predicate(entry.name)) {
			found.push(full);
		}
	}
	return found;
}

/*
 * Parse every Kconfig file into a symbol table. `if <SYM>` / `endif` nesting is
 * tracked because that is where a driver leaf gets its parent menu dependency;
 * `depends on` lines are recorded separately so the report can verify they end up
 * satisfied by the workfile rather than silently capping a symbol at n.
 */
function parse_kconfig_tree(noos_path: string): Map<string, KconfigSymbol> {
	const symbols = new Map<string, KconfigSymbol>();
	const files = walk(noos_path, name => name === "Kconfig", new Set([".git", ".no_os_venv", "libraries"]));
	/* libraries/Kconfig itself is wanted; only its cloned subtrees are skipped. */
	const libraries_kconfig = path.join(noos_path, "libraries", "Kconfig");
	if (fs.existsSync(libraries_kconfig)) {
		files.push(libraries_kconfig);
	}

	for (const file of files) {
		const scope: string[] = [];
		let current: KconfigSymbol | undefined;

		for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
			const line = raw.trim();

			const if_match = /^if\s+([A-Za-z0-9_]+)\s*$/.exec(line);
			if (if_match) {
				scope.push(if_match[1]);
				current = undefined;
				continue;
			}
			if (/^endif\b/.test(line)) {
				scope.pop();
				current = undefined;
				continue;
			}

			const config_match = /^(?:menuconfig|config)\s+([A-Za-z0-9_]+)\s*$/.exec(line);
			if (config_match) {
				const name = config_match[1];
				/*
				 * A `menuconfig` opens the scope its own `if` block re-states, so it
				 * must not depend on itself.
				 */
				current = {
					name,
					file: path.relative(noos_path, file),
					scope: scope.filter(s => s !== name),
					depends: [],
				};
				symbols.set(name, current);
				continue;
			}

			const depends_match = /^depends\s+on\s+(.+)$/.exec(line);
			if (depends_match && current) {
				for (const token of depends_match[1].match(/[A-Za-z0-9_]+/g) ?? []) {
					if (/^[A-Z][A-Z0-9_]*$/.test(token) && token !== "n" && token !== "y") {
						current.depends.push(token);
					}
				}
			}
		}
	}

	return symbols;
}

/*
 * Build the `.c path -> Kconfig symbol` map from no-OS's own build files. Entries
 * whose path still contains an unexpanded variable (${TARGET} in the platform
 * drivers) are dropped: those sources are selected by the board defconfig, never by
 * a ruleset.
 */
function parse_source_gates(noos_path: string): Map<string, string> {
	const gates = new Map<string, string>();
	const files = walk(noos_path, name => name === "CMakeLists.txt", new Set([".git", ".no_os_venv", "libraries", "builds_main_cmake"]));

	for (const file of files) {
		const dir = path.dirname(file);
		const text = fs.readFileSync(file, "utf8");
		const pattern = /no_os_sources_ifdef\s*\(\s*CONFIG_([A-Za-z0-9_]+)\s+([^)]+)\)/g;

		for (const match of text.matchAll(pattern)) {
			const symbol = match[1];
			for (const token of match[2].split(/\s+/).filter(Boolean)) {
				const resolved = token.split("${CMAKE_CURRENT_SOURCE_DIR}").join(dir);
				if (resolved.includes("${")) {
					continue;
				}
				gates.set(path.relative(noos_path, path.normalize(resolved)), symbol);
			}
		}
	}

	return gates;
}

/*
 * The generic hardware-interface symbols declared directly in the root Kconfig
 * (SPI, I2C, UART, DMA, ...). Header-derived symbols are restricted to this set so
 * that an `include/no_os_<x>.h` entry can never accidentally resolve to a driver
 * symbol that merely happens to share a name.
 */
function parse_root_interface_symbols(noos_path: string): Set<string> {
	const found = new Set<string>();
	const text = fs.readFileSync(path.join(noos_path, "Kconfig"), "utf8");
	for (const match of text.matchAll(/^\s*config\s+([A-Za-z0-9_]+)\s*$/gm)) {
		found.add(match[1]);
	}
	return found;
}

type SourceLists = { noos: string[], platform: string[], sdk: string[] };

type RulesetFacts = {
	sources: SourceLists,
	header?: string,
	type?: string,
	capability?: string,
	ranking_line?: number,
	/* Line range of an existing `$config:` block, end exclusive, for replacement. */
	config_start?: number,
	config_end?: number,
	existing: string[],
};

/*
 * Read the keys the rules need without a YAML parser, so the file can later be
 * rewritten by line surgery and stay byte-identical everywhere else.
 */
function read_sources(text: string): RulesetFacts {
	const lines = text.split("\n");
	const sources: SourceLists = { noos: [], platform: [], sdk: [] };
	let header: string | undefined;
	let type: string | undefined;
	let capability: string | undefined;
	let ranking_line: number | undefined;
	let config_start: number | undefined;
	let config_end: number | undefined;
	const existing: string[] = [];

	let in_sources = false;
	let bucket: keyof SourceLists | undefined;

	for (const [index, raw] of lines.entries()) {
		if (/^\$ranking:/.test(raw)) {
			ranking_line = index;
		}
		const type_match = /^\$type:\s*"?([\w-]+)"?\s*$/.exec(raw);
		if (type_match) {
			type = type_match[1];
		}
		const capability_match = /^\$capability:\s*"?([\w-]+)"?\s*$/.exec(raw);
		if (capability_match) {
			capability = capability_match[1];
		}

		/*
		 * An existing block is either `$config: []` on one line or `$config:` followed
		 * by list items, so the end is the first line that is not a list item.
		 */
		if (/^\$config:/.test(raw)) {
			config_start = index;
			config_end = index + 1;
			for (let next = index + 1; next < lines.length; next += 1) {
				const item = /^\s+-\s*"?([^"]+)"?\s*$/.exec(lines[next]);
				if (!item) {
					break;
				}
				existing.push(item[1].trim());
				config_end = next + 1;
			}
		}

		const header_match = /^\$header:\s*"?([^"]+)"?\s*$/.exec(raw);
		if (header_match) {
			header = header_match[1].trim();
		}

		if (/^\$sources:/.test(raw)) {
			in_sources = true;
			bucket = undefined;
			continue;
		}
		if (in_sources && /^\S/.test(raw)) {
			in_sources = false;
			bucket = undefined;
		}
		if (!in_sources) {
			continue;
		}

		const bucket_match = /^\s{2}(\w+):\s*$/.exec(raw);
		if (bucket_match) {
			const name = bucket_match[1];
			bucket = name === "noos" || name === "platform" || name === "sdk" ? name : undefined;
			continue;
		}

		const item_match = /^\s{4}-\s*"?([^"]+)"?\s*$/.exec(raw);
		if (item_match && bucket) {
			sources[bucket].push(item_match[1].trim());
		}
	}

	return { sources, header, type, capability, ranking_line, config_start, config_end, existing };
}

type Resolution = { symbols: string[], unmapped: string[] };

function resolve_symbols(
	facts: RulesetFacts,
	relative: string,
	kconfig: Map<string, KconfigSymbol>,
	gates: Map<string, string>,
	interfaces: Set<string>,
): Resolution {
	const { sources, header } = facts;
	const symbols = new Set<string>();
	const unmapped: string[] = [];

	const add_with_parents = (symbol: string): void => {
		symbols.add(symbol);
		for (const parent of kconfig.get(symbol)?.scope ?? []) {
			symbols.add(parent);
		}
	};

	if (facts.type === "platform_ops") {
		const own = facts.capability === undefined ? undefined : CAPABILITY_SYMBOLS[facts.capability];
		if (own === undefined) {
			/* A new capability with no entry above: report it rather than guess. */
			unmapped.push(`$capability: ${facts.capability ?? "(missing)"}`);
		} else {
			add_with_parents(own);
		}

		for (const coupling of CROSS_DRIVER_SYMBOLS) {
			if (coupling.pattern.test(relative)) {
				for (const symbol of coupling.symbols) {
					add_with_parents(symbol);
				}
			}
		}
	}

	/*
	 * `$header` exists for the generated #include list, but its sibling .c is the
	 * driver's gated source, so it is also a second, independent route to the leaf
	 * symbol. Following it means a device ruleset that lists only its header still
	 * resolves - the same reason the API headers are mapped above.
	 */
	const candidates = [...sources.noos];
	if (header !== undefined) {
		candidates.push(header.replace(/\.h$/, ".c"));
	}

	for (const entry of candidates) {
		/* Generic API layer: header and .c both point at the root interface symbol. */
		const api_match = /^(?:include\/no_os_(\w+)\.h|drivers\/api\/no_os_(\w+)\.c)$/.exec(entry);
		if (api_match) {
			const gate = gates.get(entry.replace(/\.h$/, ".c"));
			const derived = (api_match[1] ?? api_match[2]).toUpperCase();
			/*
			 * Prefer the CMakeLists gate when the file is a .c; it is authoritative and
			 * catches the cases where the symbol is not just the uppercased basename
			 * (no_os_gnss.c is gated on CONFIG_GNSS_GPS).
			 */
			if (entry.endsWith(".c") && gate !== undefined) {
				add_with_parents(gate);
			} else if (interfaces.has(derived)) {
				add_with_parents(derived);
			} else if (entry.endsWith(".c")) {
				unmapped.push(entry);
			}
			/*
			 * A header with no matching interface symbol is genuinely ungated:
			 * include/no_os_ain.h and no_os_aout.h have no .c and no Kconfig symbol.
			 */
			continue;
		}

		if (!entry.endsWith(".c")) {
			continue;
		}

		const gate = gates.get(entry);
		if (gate === undefined) {
			unmapped.push(entry);
			continue;
		}
		add_with_parents(gate);
	}

	return { symbols: [...symbols].sort(), unmapped };
}

/*
 * Write the block, replacing one that is already there so a re-run is idempotent. A
 * first insert goes just below `$ranking:`, which every ruleset has.
 */
function write_config(text: string, symbols: string[], facts: RulesetFacts): string {
	const lines = text.split("\n");
	const block = symbols.length === 0
		? ["$config: []"]
		: ["$config:", ...symbols.map(s => `  - "${s}"`)];

	if (facts.config_start !== undefined && facts.config_end !== undefined) {
		lines.splice(facts.config_start, facts.config_end - facts.config_start, ...block);
	} else if (facts.ranking_line !== undefined) {
		lines.splice(facts.ranking_line + 1, 0, ...block);
	}
	return lines.join("\n");
}

function main(): void {
	const args = process.argv.slice(2);
	const noos_path = args.find(a => !a.startsWith("--"));
	const write = args.includes("--write");

	if (noos_path === undefined) {
		console.error("usage: sources_to_config <no-OS-path> [--write]");
		process.exit(1);
	}

	const schemas_root = path.join(noos_path, "schemas");
	if (!fs.existsSync(schemas_root)) {
		console.error(`No schemas directory under ${noos_path}`);
		process.exit(1);
	}

	const kconfig = parse_kconfig_tree(noos_path);
	const gates = parse_source_gates(noos_path);
	const interfaces = parse_root_interface_symbols(noos_path);

	console.log(`Kconfig symbols: ${String(kconfig.size)}`);
	console.log(`CMakeLists source gates: ${String(gates.size)}`);
	console.log(`Root interface symbols: ${[...interfaces].sort().join(", ")}`);
	console.log("");

	const files = walk(schemas_root, name => name.endsWith(".yaml"), new Set([".git"])).sort();

	const all_unmapped = new Map<string, string[]>();
	const unsatisfied = new Map<string, string[]>();
	const skipped: string[] = [];
	const changed: { file: string, before: string[], after: string[] }[] = [];
	let written = 0;
	const summary: { file: string, symbols: string[] }[] = [];

	for (const file of files) {
		const text = fs.readFileSync(file, "utf8");
		const relative = path.relative(schemas_root, file);

		if (!/^\$type:/m.test(text)) {
			skipped.push(`${relative} (not a ruleset)`);
			continue;
		}

		const facts = read_sources(text);
		if (facts.ranking_line === undefined && facts.config_start === undefined) {
			skipped.push(`${relative} (no $ranking line to anchor the insert)`);
			continue;
		}

		const { symbols, unmapped } = resolve_symbols(facts, relative, kconfig, gates, interfaces);

		/*
		 * What a re-run would change is the thing worth reading in the report: on a
		 * first pass everything is new, afterwards this is the review list.
		 */
		const before = [...facts.existing].sort();
		if (before.join(",") !== symbols.join(",")) {
			changed.push({ file: relative, before, after: symbols });
		}

		if (unmapped.length > 0) {
			all_unmapped.set(relative, unmapped);
		}

		/*
		 * Report `depends on` symbols this ruleset does not itself provide. Most are
		 * expected and correct - a device depends on SPI, which arrives from the bus
		 * init_param that is a separate workfile symbol - so this is a review aid, not
		 * an error.
		 */
		const missing = new Set<string>();
		for (const symbol of symbols) {
			for (const dependency of kconfig.get(symbol)?.depends ?? []) {
				if (!symbols.includes(dependency)) {
					missing.add(dependency);
				}
			}
		}
		if (missing.size > 0) {
			unsatisfied.set(relative, [...missing].sort());
		}

		summary.push({ file: relative, symbols });

		if (write) {
			fs.writeFileSync(file, write_config(text, symbols, facts), "utf8");
			written += 1;
		}
	}

	console.log("=== resolved symbols (non-empty) ===");
	for (const { file, symbols } of summary) {
		if (symbols.length > 0) {
			console.log(`  ${file}`);
			console.log(`      ${symbols.join(", ")}`);
		}
	}

	const empty = summary.filter(s => s.symbols.length === 0);
	console.log(`\n=== empty $config (${String(empty.length)} files) ===`);
	for (const { file } of empty) {
		console.log(`  ${file}`);
	}

	console.log(`\n=== unmapped .c sources (${String(all_unmapped.size)}) ===`);
	for (const [file, entries] of all_unmapped) {
		console.log(`  ${file}: ${entries.join(", ")}`);
	}

	console.log(`\n=== depends-on not provided by the same ruleset (${String(unsatisfied.size)}) ===`);
	for (const [file, entries] of unsatisfied) {
		console.log(`  ${file}: ${entries.join(", ")}`);
	}

	console.log(`\n=== changed by this run (${String(changed.length)}) ===`);
	for (const { file, before, after } of changed) {
		console.log(`  ${file}`);
		console.log(`      ${before.length === 0 ? "(none)" : before.join(", ")}  ->  ${after.length === 0 ? "(none)" : after.join(", ")}`);
	}

	console.log(`\n=== skipped (${String(skipped.length)}) ===`);
	for (const entry of skipped) {
		console.log(`  ${entry}`);
	}

	console.log(`\nrulesets processed: ${String(summary.length)}`);
	console.log(write ? `files written: ${String(written)}` : "dry run (pass --write to apply)");
}

main();
