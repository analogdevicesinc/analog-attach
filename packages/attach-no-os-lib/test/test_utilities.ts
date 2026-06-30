import { expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { Result, error } from '../src/ruleset_parser/result';
import { Property } from '../src/ruleset_parser/types';
import { parse_property, parse_ruleset } from '../src/ruleset_parser/ruleset_parser';
import { Ruleset } from '../src/ruleset_parser/types';

export function expectOk<T>(result: Result<T>): asserts result is { ok: true; value: T } {
	if (!result.ok) {
		expect.fail(`Expected ok but got error:\n${JSON.stringify(result.error, undefined, 2)}`);
	}
}

export function expectError<T>(result: Result<T>): asserts result is { ok: false; error: { _t: "RulesetError"; message: string; path: string } } {
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

