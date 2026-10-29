import { expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { Result, error } from '../src/ruleset_parser/result';
import { Property } from '../src/ruleset_parser/types';
import { parse_property, parse_ruleset } from '../src/ruleset_parser/ruleset_parser';
import { Ruleset } from '../src/ruleset_parser/types';
import { memory_settings, use_settings } from '../src/settings/settings';
import { reset_registry } from '../src/registry/registry';

/*
 * The miniature CAPI ecosystem under test/fixtures. Checked in rather than read out of a
 * sibling checkout, so the tests run anywhere and describe only shapes this tool supports.
 * See test/fixtures/README.md.
 */
export const FIXTURES_ROOT = path.resolve(__dirname, 'fixtures');
export const FIXTURE_CAPI = path.join(FIXTURES_ROOT, 'capi');
export const FIXTURE_PLATFORM = path.join(FIXTURES_ROOT, 'platform');
export const FIXTURE_DRIVERS = path.join(FIXTURES_ROOT, 'driver-collection');
/** A second driver collection, opted into by the tests that need two ADC parts. */
export const FIXTURE_ADC_DRIVERS = path.join(FIXTURES_ROOT, 'adc-drivers');

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

/**
 * Point the library at a set of module roots, defaulting to the fixture ecosystem, through
 * an in-memory settings source. `values` are more settings (`bootstrap`, `board`, ...).
 *
 * The registry is built once per source and memoised, so it is reset here as well as on
 * teardown: a test that changes the roots must not inherit the previous test's index.
 */
export function setup_test_config(roots: { capi?: string; modules?: string[] } = {}, values: Record<string, string> = {}): void {
	const modules = roots.modules ?? [FIXTURE_PLATFORM, FIXTURE_DRIVERS];
	use_settings(memory_settings({ ...values, "capi-path": roots.capi ?? FIXTURE_CAPI, "module-paths": modules }, os.tmpdir()));
	reset_registry();
}

export function teardown_test_config(): void {
	use_settings(undefined);
	reset_registry();
}

export function setup_no_config(): void {
	use_settings(memory_settings({}, '/nonexistent/path'));
	reset_registry();
}

export function teardown_no_config(): void {
	use_settings(undefined);
	reset_registry();
}
