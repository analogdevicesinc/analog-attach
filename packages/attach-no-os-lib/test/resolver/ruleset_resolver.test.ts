import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { expectOk, expectError, expectErrorContains } from '../test_utils';
import { resolve_includes_from_ruleset } from '../../src/resolver/ruleset_resolver';
import { parse_binding } from '../../src/bindings_parser/binding_parser';
import { RulesetStruct, ResolvedRulesetProperty } from '../../src/bindings_parser/types';

function loadFixture(relativePath: string): string {
	return fs.readFileSync(path.resolve(__dirname, 'fixtures', relativePath), 'utf8');
}

function loadAndResolve(fixturePath: string) {
	const yaml = loadFixture(fixturePath);
	const parsed = parse_binding(yaml);
	if (!parsed.ok) {return parsed;}
	return resolve_includes_from_ruleset(parsed.value);
}

describe('resolve_includes_from_ruleset', () => {
	describe('basic include resolution', () => {
		test('resolves a simple include property', () => {
			const result = loadAndResolve('simple_include.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const property = ruleset.properties.find(p => p.name === "spi_init");
			expect(property?._t).toBe("ResolvedRulesetProperty");
			const resolved = property as ResolvedRulesetProperty;
			expect(resolved.resolved.$name).toBe("no_os_spi_init_param");
		});

		test('preserves pointer flag after resolution', () => {
			const result = loadAndResolve('include_with_pointer.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const property = ruleset.properties.find(p => p.name === "spi_init") as ResolvedRulesetProperty;
			expect(property.pointer).toBe(true);
		});

		test('resolves nested includes recursively', () => {
			const result = loadAndResolve('simple_include.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const spi = ruleset.properties.find(p => p.name === "spi_init") as ResolvedRulesetProperty;
			const spiStruct = spi.resolved as RulesetStruct;
			const mode = spiStruct.properties.find(p => p.name === "mode");
			expect(mode?._t).toBe("ResolvedRulesetProperty");
		});
	});

	describe('union property resolution', () => {
		test('resolves all union member includes', () => {
			const result = loadAndResolve('union_include.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const comm = ruleset.properties.find(p => p.name === "comm");
			expect(comm?._t).toBe("UnionProperty");
			if (comm?._t === "UnionProperty") {
				expect(comm.members.length).toBe(2);
				expect(comm.members[0]._t).toBe("ResolvedRulesetProperty");
				expect(comm.members[1]._t).toBe("ResolvedRulesetProperty");
				expect((comm.members[0] as ResolvedRulesetProperty).resolved.$name).toBe("no_os_spi_init_param");
				expect((comm.members[1] as ResolvedRulesetProperty).resolved.$name).toBe("no_os_i2c_init_param");
			}
		});
	});

	describe('array property resolution', () => {
		test('resolves array element include', () => {
			const result = loadAndResolve('array_include.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const channels = ruleset.properties.find(p => p.name === "channels");
			expect(channels?._t).toBe("ArrayProperty");
			if (channels?._t === "ArrayProperty") {
				expect(channels.element._t).toBe("ResolvedRulesetProperty");
				expect((channels.element as ResolvedRulesetProperty).resolved.$name).toBe("no_os_gpio_init_param");
			}
		});

		test('leaves primitive array elements unchanged', () => {
			const result = loadAndResolve('array_primitive.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const values = ruleset.properties.find(p => p.name === "values");
			expect(values?._t).toBe("ArrayProperty");
			if (values?._t === "ArrayProperty") {
				expect(values.element._t).toBe("NumberProperty");
			}
		});
	});

	describe('non-struct rulesets', () => {
		test('returns enum ruleset unchanged', () => {
			const result = loadAndResolve('enum_ruleset.yaml');
			expectOk(result);
			expect(result.value._t).toBe("BindingEnum");
		});
	});

	describe('error cases', () => {
		test('returns error for missing include file', () => {
			const result = loadAndResolve('missing_include.yaml');
			expectError(result);
			expectErrorContains(result, "Failed to read");
		});

		test('returns error for missing union member include', () => {
			const result = loadAndResolve('union_missing_include.yaml');
			expectError(result);
			expectErrorContains(result, "Failed to read");
		});

		test('returns error for missing array element include', () => {
			const result = loadAndResolve('array_missing_include.yaml');
			expectError(result);
			expectErrorContains(result, "Failed to read");
		});
	});
});
