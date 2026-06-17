import { expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import { Result, error } from '../src/bindings_parser/result';
import { Property } from '../src/bindings_parser/types';
import { parse_property, parse_binding } from '../src/bindings_parser/binding_parser';
import { Binding } from '../src/bindings_parser/types';

export function expectOk<T>(result: Result<T>): asserts result is { ok: true; value: T } {
	if (!result.ok) {
		expect.fail(`Expected ok but got error:\n${JSON.stringify(result.error, null, 2)}`);
	}
}

export function expectError<T>(result: Result<T>): asserts result is { ok: false; error: { _t: "BindingError"; message: string; path: string } } {
	if (result.ok) {
		expect.fail(`Expected error but got ok:\n${JSON.stringify(result.value, null, 2)}`);
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
	} catch (e) {
		return error(`YAML parse error: ${e}`, "");
	}

	return parse_property(name, parsed, { path: "", document: {} });
}

export function loadAndParseProperty(fixturePath: string, name: string = "test_prop"): Result<Property> {
	const yaml = loadFixture(fixturePath);
	return parsePropertyFromYaml(yaml, name);
}

export function loadAndParseBinding(fixturePath: string): Result<Binding> {
	const yaml = loadFixture(fixturePath);
	return parse_binding(yaml);
}

