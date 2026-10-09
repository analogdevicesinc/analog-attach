import type { ChipSelectBinding } from "./module_yml";
import type { RulesetType } from "../ruleset_parser/types";

/**
 * Build facts a module declares about its own code, read from its `module.yml`.
 *
 * These used to live on each ruleset as `$config` / `$sources`, which let them drift from
 * what the build actually compiled. They belong to the module that ships the symbol, not
 * to the symbol, so they are read here and reached through the ruleset's registry entry.
 */
export interface ModuleBuild {
	/** Kconfig symbol that turns this module on, without the CONFIG_ prefix. */
	kconfig?: string,
	sources?: string[],
	includes?: string[],
}

export interface ModuleInfo {
	name: string,
	/** `module.yml` `type:` — driver, platform, interface, driver_collection, ... */
	type: string,
	/** Absolute path of the module root, i.e. the directory holding its `module.yml`. */
	path: string,
	description?: string,
	build?: ModuleBuild,
	/**
	 * Ruleset index this module declares, relative to the module root. A module with no
	 * rulesets of its own (a platform backend, say) leaves it unset and contributes no
	 * symbols.
	 */
	rulesets_file?: string,
	/**
	 * Sub-modules a `driver_category` declares, as directory names relative to its own
	 * directory. This is the declared edge that gets us from a category to the drivers
	 * holding the rulesets.
	 */
	drivers?: string[],
	/**
	 * Boards a `platform` module supports, as declared in its `boards:` list. The names
	 * are the subdirectories of `boards/` holding each one's `platform_board` module.
	 */
	boards?: string[],
	/** Chips a `platform` module supports, from its `socs:` list. */
	socs?: SocInfo[],
	/** Interface metadata file (`interfaces_file:`): ops symbol and headers per interface. */
	interfaces_file?: string,
	/** `metadata.vendor`, e.g. "maxim". */
	vendor?: string,
	/** `metadata.mcu` of a `platform_board`: which chip the board carries. */
	mcu?: string,
	/** `pinout.connectors`: the physical connectors a board or part exposes. */
	connectors?: ConnectorInfo[],
	/** `implements.driver` of an `eval_board`: the part it carries. */
	implements_driver?: string,
	/**
	 * `provides.interfaces` — the CAPI interfaces this module implements, e.g.
	 * `[accel_sensor]`. This is the declared edge from an interface to the driver behind it,
	 * which is how a `driver_ops` or `driver_init_param` property finds its candidates
	 * without relying on symbol-name conventions.
	 */
	provides_interfaces?: string[],
	/** `depends.packages` names: the libraries a driver builds against, e.g. capi-util. */
	packages?: string[],
}

/** Which MCU GPIO a pin is, in the chip's own port vocabulary (e.g. MXC_GPIO2). */
export interface GpioIdentity {
	port: string,
	number: number,
}

/** One pin of a connector, as a pinout declares it. */
export interface PinInfo {
	/** As written: a position on a header ("11") or a chip pin name ("P0_18"). */
	pin: string,
	roles: string[],
	mnemonic?: string,
	gpio?: GpioIdentity,
}

/** One connector in a module's pinout. */
export interface ConnectorInfo {
	name: string,
	/** Stable name a board.yml `pins:` entry or a wire refers to it by. */
	id?: string,
	/**
	 * Physical standard (`pmod_12`, `feather_16`), from capi's `connector_types`. Two
	 * connectors mate pin-for-pin only when both declare the same one.
	 */
	type?: string,
	pins: PinInfo[],
}

/**
 * One chip a platform supports, as its `socs:` list declares it.
 *
 * `descriptor` points at the per-chip file holding the rest (memory sizes, and the
 * peripheral instance counts that bound a controller `identifier`). It is read on demand
 * rather than eagerly: most commands never need it.
 */
export interface SocInfo {
	name: string,
	arch?: string,
	cpu?: string,
	/** Path to the chip's descriptor file, relative to the platform module root. */
	descriptor?: string,
}

/** A board, resolved from a platform module's declared board list. */
export interface BoardInfo {
	name: string,
	/** The platform module that supports it, by module name (e.g. "capi-maxim"). */
	platform: string,
	/** Chip the board carries, from the board module's `metadata.mcu`. */
	soc?: string,
	vendor?: string,
	description?: string,
	/** Absolute path of the board module directory. */
	path: string,
	/** The board's own pinout: its headers and on-board pins. */
	connectors: ConnectorInfo[],
}

/** One ruleset file, located and attributed but not yet parsed. */
export interface RulesetEntry {
	$symbol: string,
	/**
	 * `$type` as declared, captured while indexing. Knowing a symbol's kind without parsing
	 * it is what lets candidates be filtered - instantiable nodes, a driver's externs - from
	 * the index alone.
	 */
	$type: RulesetType,
	/** Absolute path of the ruleset file. */
	file: string,
	/** The `rulesets:` key it was listed under, which mirrors its directory. */
	group: string,
	/** The module whose index listed it, and whose build facts therefore apply. */
	module: ModuleInfo,
}

/**
 * Every ruleset reachable from the configured module roots, keyed by the `$symbol` that
 * `include:` and `$compatible` name.
 *
 * Built eagerly and held for the life of the process: a CLI invocation reads the indexes
 * once, and `list`/suggestion commands need the whole symbol set anyway. Nothing is
 * cached on disk — the indexes are small, and a stale cache would be worse than the read.
 */
export interface Registry {
	modules: ModuleInfo[],
	symbols: Map<string, RulesetEntry>,
	/**
	 * Board peripheral kind to the C type it has, merged from every module that declares
	 * `bsp_kinds:`. Used to synthesize a board's externs; see registry/bsp.ts.
	 */
	bsp_kinds: Map<string, string>,
	/** How a SPI device carries its chip-select, when a configured module declares it. */
	chip_select?: ChipSelectBinding,
}
