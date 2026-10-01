import { expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { Result, error } from '../src/ruleset_parser/result';
import { Property } from '../src/ruleset_parser/types';
import { parse_property, parse_ruleset } from '../src/ruleset_parser/ruleset_parser';
import { Ruleset } from '../src/ruleset_parser/types';
import { set_settings, set_config_path_override } from '../src/settings/settings';
import { SETTINGS_DEFAULTS } from '../src/settings/globals';
import { SettingsFile } from '../src/settings/types';
import { reset_registry } from '../src/registry/registry';
import { PATH_LIST_DELIMITER } from '../src/settings/globals';

/*
 * The miniature CAPI ecosystem under test/fixtures. Checked in rather than read out of a
 * sibling checkout, so the tests run anywhere and describe only shapes this tool supports.
 * See test/fixtures/README.md.
 */
export const FIXTURES_ROOT = path.resolve(__dirname, 'fixtures');
export const FIXTURE_CAPI = path.join(FIXTURES_ROOT, 'capi');
export const FIXTURE_PLATFORM = path.join(FIXTURES_ROOT, 'platform');
export const FIXTURE_DRIVERS = path.join(FIXTURES_ROOT, 'driver-collection');

/** The board most tests target, and the chip it carries. */
export const FIXTURE_BOARD = 'testboard';
export const FIXTURE_SOC = 'testsoc';

export function expectOk<T>(result: Result<T>): asserts result is { ok: true; value: T } {
	if (!result.ok) {
		expect.fail(`Expected ok but got error:\n${JSON.stringify(result.error, undefined, 2)}`);
	}
}

export function expectError<T>(result: Result<T>): asserts result is { ok: false; error: { message: string; path?: string } } {
	if (result.ok) {
		expect.fail(`Expected error but got ok:\n${JSON.stringify(result.value, undefined, 2)}`);
	}
}

export function expectErrorPath<T>(result: Result<T>, expectedPath: string): void {
	expectError(result);
	expect(result.error.path).toBe(expectedPath);
}

export function expectErrorContains<T>(result: Result<T>, substring: string): void {
	expectError(result);
	expect(result.error.message).toContain(substring);
}

export function loadFixture(relativePath: string): string {
	return fs.readFileSync(path.resolve(__dirname, 'binding_parser/fixtures', relativePath), 'utf8');
}

export function parsePropertyFromYaml(yaml: string, name: string = "test_prop"): Result<Property> {
	let parsed: unknown;
	try {
		parsed = YAML.parse(yaml);
	} catch (error_) {
		return error(`YAML parse error: ${error_}`, "");
	}

	return parse_property(name, parsed, { path: "", document: {} });
}

export function loadAndParseProperty(fixturePath: string, name: string = "test_prop"): Result<Property> {
	const yaml = loadFixture(fixturePath);
	return parsePropertyFromYaml(yaml, name);
}

export function loadAndParseRuleset(fixturePath: string): Result<Ruleset> {
	const yaml = loadFixture(fixturePath);
	return parse_ruleset(yaml);
}

const temp_config_paths: string[] = [];

/**
 * Point the library at a set of module roots, defaulting to the fixture ecosystem.
 *
 * The registry is built once per process and memoised, so it is reset here as well as on
 * teardown: a test that changes the roots must not inherit the previous test's index.
 */
export function setup_test_config(roots: { capi?: string; modules?: string[] } = {}): void {
	const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-no-os-test-'));
	const temp_config_path = path.join(temp_dir, 'config.json');

	temp_config_paths.push(temp_config_path);
	set_config_path_override(temp_config_path);

	const modules = roots.modules ?? [FIXTURE_PLATFORM, FIXTURE_DRIVERS];

	const settings: SettingsFile = {
		...SETTINGS_DEFAULTS,
		capi_path: {
			...SETTINGS_DEFAULTS.capi_path,
			value: roots.capi ?? FIXTURE_CAPI
		},
		module_paths: {
			...SETTINGS_DEFAULTS.module_paths,
			value: modules.join(PATH_LIST_DELIMITER)
		}
	};

	set_settings(settings);
	reset_registry();
}

export function teardown_test_config(): void {
	const temp_config_path = temp_config_paths.pop();

	set_config_path_override(null);
	reset_registry();

	if (temp_config_path && fs.existsSync(temp_config_path)) {
		const temp_dir = path.dirname(temp_config_path);
		fs.rmSync(temp_dir, { recursive: true, force: true });
	}
}

export function setup_no_config(): void {
	set_config_path_override('/nonexistent/path/to/config.json');
	reset_registry();
}

export function teardown_no_config(): void {
	set_config_path_override(null);
	reset_registry();
}

