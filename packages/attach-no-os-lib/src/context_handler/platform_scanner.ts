import * as fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { Result, ok, error } from "../bindings_parser/result";
import { asObject, at, optional, required, string_, ParseContext } from "../bindings_parser/validators";
import { CapabilitySpec, PlatformCapabilities } from "./types";

const MANIFEST_FILENAME = "platform.yaml";

/**
 * Parse and validate a platform.yaml manifest
 */
function parse_manifest(manifest: unknown, platform_path: string): Result<PlatformCapabilities> {
	const context: ParseContext = { path: MANIFEST_FILENAME, document: {} };

	const object = asObject(manifest, context);
	if (!object.ok) {
		return object;
	}

	const capabilities_object = required(object.value, "capabilities", context, asObject);
	if (!capabilities_object.ok) {
		return capabilities_object;
	}

	const capabilities_context = at(context, "capabilities");
	const capabilities: PlatformCapabilities = {};

	for (const [capability_name, capability_value] of Object.entries(capabilities_object.value)) {
		const capability_context = at(capabilities_context, capability_name);

		const capability_object = asObject(capability_value, capability_context);
		if (!capability_object.ok) {
			return capability_object;
		}

		const ops = required(capability_object.value, "ops", capability_context, string_);
		if (!ops.ok) {
			return ops;
		}

		const extra = optional(capability_object.value, "extra", capability_context, string_);
		if (!extra.ok) {
			return extra;
		}

		// Validate that referenced files exist
		const ops_path = path.join(platform_path, ops.value);
		if (!fs.existsSync(ops_path)) {
			return error(`Ops file does not exist: ${ops.value}`, at(capability_context, "ops").path);
		}

		if (extra.value) {
			const extra_path = path.join(platform_path, extra.value);
			if (!fs.existsSync(extra_path)) {
				return error(`Extra file does not exist: ${extra.value}`, at(capability_context, "extra").path);
			}
		}

		const spec: CapabilitySpec = { ops: ops.value };
		if (extra.value) {
			spec.extra = extra.value;
		}

		capabilities[capability_name] = spec;
	}

	return ok(capabilities);
}

/**
 * Scan a platform directory by reading its platform.yaml manifest
 */
export function scan_platform(platform_path: string): Result<PlatformCapabilities> {
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
export function scan_platforms(root_path: string): Result<Record<string, PlatformCapabilities>> {
	if (!fs.existsSync(root_path)) {
		return error(`Root path does not exist: ${root_path}`, "root_path");
	}

	const result: Record<string, PlatformCapabilities> = {};

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
