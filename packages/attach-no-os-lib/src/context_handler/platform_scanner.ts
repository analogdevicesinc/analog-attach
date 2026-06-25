import * as fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { Result, ok, error } from "../bindings_parser/result";
import { asObject, at, optional, ParseContext, stringArray } from "../bindings_parser/validators";
import { get_schemas_path } from "../settings/settings";
import { PlatformManifest, PlatformSpecs } from "./types";

const MANIFEST_FILENAME = "platform.yaml";

/**
 * Parse and validate a platform.yaml manifest
 */
function parse_manifest(manifest: unknown, platform_path: string): Result<PlatformManifest> {
	const context: ParseContext = { path: MANIFEST_FILENAME, document: {} };

	const object = asObject(manifest, context);
	if (!object.ok) {
		return object;
	}

	const ops = optional(object.value, "ops", context, stringArray);
	if (!ops.ok) {
		return ops;
	}

	const structs = optional(object.value, "structs", context, stringArray);
	if (!structs.ok) {
		return structs;
	}

	// Validate that referenced files exist
	const ops_list = ops.value ?? [];
	for (const ops_path of ops_list) {
		const full_path = path.join(platform_path, ops_path);
		if (!fs.existsSync(full_path)) {
			return error(`Ops file does not exist: ${ops_path}`, at(context, "ops").path);
		}
	}

	const structs_list = structs.value ?? [];
	for (const struct_path of structs_list) {
		const full_path = path.join(platform_path, struct_path);
		if (!fs.existsSync(full_path)) {
			return error(`Struct file does not exist: ${struct_path}`, at(context, "structs").path);
		}
	}

	// Convert paths to be relative to schemas root
	const schemas_path = get_schemas_path();
	const relative_prefix = schemas_path
		? path.relative(schemas_path, platform_path)
		: "";

	const prefixed_ops = ops_list.map(p => path.join(relative_prefix, p));
	const prefixed_structs = structs_list.map(p => path.join(relative_prefix, p));

	// Get platform name from directory
	const platform_name = path.basename(platform_path);

	return ok({
		name: platform_name,
		ops: prefixed_ops,
		structs: prefixed_structs,
	});
}

/**
 * Scan a platform directory by reading its platform.yaml manifest
 */
export function scan_platform(platform_path: string): Result<PlatformManifest> {
	if (!fs.existsSync(platform_path)) {
		return error(`Platform path does not exist: ${platform_path}`, "platform_path");
	}

	const stats = fs.statSync(platform_path);
	if (!stats.isDirectory()) {
		return error(`Platform path is not a directory: ${platform_path}`, "platform_path");
	}

	const manifest_path = path.join(platform_path, MANIFEST_FILENAME);
	if (!fs.existsSync(manifest_path)) {
		return error(`Missing ${MANIFEST_FILENAME} in: ${platform_path}`, MANIFEST_FILENAME);
	}

	let manifest_content: string;
	try {
		manifest_content = fs.readFileSync(manifest_path, "utf8");
	} catch {
		return error(`Failed to read ${MANIFEST_FILENAME}`, MANIFEST_FILENAME);
	}

	let parsed: unknown;
	try {
		parsed = YAML.parse(manifest_content);
	} catch (parse_error) {
		return error(`Failed to parse ${MANIFEST_FILENAME}: ${parse_error}`, MANIFEST_FILENAME);
	}

	return parse_manifest(parsed, platform_path);
}

/**
 * Recursively find all platform.yaml files and scan those directories
 */
export function scan_platforms(root_path: string): Result<PlatformSpecs> {
	if (!fs.existsSync(root_path)) {
		return error(`Root path does not exist: ${root_path}`, "root_path");
	}

	const result: PlatformSpecs = {};

	function find_platforms(directory: string): void {
		const manifest_path = path.join(directory, MANIFEST_FILENAME);

		if (fs.existsSync(manifest_path)) {
			// Found a platform, scan it
			const platform_name = path.basename(directory);
			const scan_result = scan_platform(directory);

			if (scan_result.ok) {
				result[platform_name] = scan_result.value;
			} else {
				console.warn(`[platform_scanner] Failed to scan platform '${platform_name}': ${scan_result.error.message}`);
			}
			// Don't recurse into platform directories
			return;
		}

		// Recurse into subdirectories
		const entries = fs.readdirSync(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				find_platforms(path.join(directory, entry.name));
			}
		}
	}

	find_platforms(root_path);

	return ok(result);
}
