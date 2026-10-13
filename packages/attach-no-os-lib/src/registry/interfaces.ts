/**
 * A platform's ops tables, from the `interfaces_file` its module.yml names
 * (capi-maxim: sdk/interfaces.yml):
 *
 *   - {name: spi, header: [maxim_capi_spi.h], ops_symbol: maxim_capi_spi_ops, capi_header: [capi_spi.h]}
 *
 * Each interface with an ops table becomes a platform ops entry - `maxim_capi_spi_ops`, for
 * `spi` - which is what a config's `ops: {type: platform_ops, capability: spi}` takes. On a
 * board these are rarely needed (the BSP's own configs already point at them); a bus the user
 * configures by hand, or a chip with no board, needs them.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import type { RulesetPlatformOps } from "../ruleset_parser/types";
import { RulesetType } from "../ruleset_parser/types";
import type { ModuleInfo } from "./types";

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The ops tables a platform declares, one per interface that has one. None without an interfaces_file. */
export function platform_ops_tables(platform: ModuleInfo): Result<RulesetPlatformOps[]> {
	if (platform.interfaces_file === undefined) {
		return ok([]);
	}
	const file = path.join(platform.path, platform.interfaces_file);
	let parsed: unknown;
	try {
		parsed = YAML.parse(fs.readFileSync(file, "utf8"));
	} catch (error_) {
		return error(`Failed to read ${file}: ${error_ instanceof Error ? error_.message : String(error_)}`, file);
	}

	const interfaces = (parsed as { interfaces?: unknown } | null)?.interfaces;
	if (!Array.isArray(interfaces)) {
		return error(`${file} has no interfaces list`, file);
	}

	return ok(interfaces.flatMap(entry => {
		const { name, ops_symbol, header, capi_header } = (entry ?? {}) as Record<string, unknown>;
		if (typeof name !== "string" || typeof ops_symbol !== "string") {
			return [];
		}
		return [{
			_t: "RulesetPlatformOps" as const,
			$type: RulesetType.RT_PLATFORM_OPS as const,
			$symbol: ops_symbol,
			$description: `${platform.name} ${name} ops`,
			$capability: name,
			$headers: [...strings(header), ...strings(capi_header)],
		}];
	}));
}
