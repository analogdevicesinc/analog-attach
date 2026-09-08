import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { IncludeProperty, RulesetStruct, RulesetType } from '../../src/ruleset_parser/types';

describe('RulesetStruct parsing', () => {
	describe('valid cases', () => {
		test('parses minimal struct binding', () => {
			const result = loadAndParseRuleset('bindings/struct/valid_minimal.yaml');
			expectOk(result);
			expect(result.value._t).toBe('RulesetStruct');
			expect(result.value.$type).toBe(RulesetType.RT_STRUCT);
			expect(result.value.$id).toBe('test/minimal_struct');
			expect(result.value.$symbol).toBe('minimal_init_param');
		});

		test('parses struct with properties', () => {
			const result = loadAndParseRuleset('bindings/struct/valid_with_properties.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.properties).toHaveLength(3);
			expect(binding.$description).toBe('A struct with properties');
			expect(binding.$ranking).toBe(2);
		});

		test('parses struct with override', () => {
			const result = loadAndParseRuleset('bindings/struct/valid_with_override.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.rules).toBeDefined();
			expect(binding.rules!.length).toBeGreaterThanOrEqual(1);
		});

		test('auto-computes $requires from property capabilities', () => {
			const result = loadAndParseRuleset('bindings/struct/valid_with_capabilities.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.$requires).toBeDefined();
			expect(binding.$requires).toContain('spi');
			expect(binding.$requires).toContain('irq');
			expect(binding.$requires).toHaveLength(2);
		});

		test('$requires is undefined when no properties have capabilities', () => {
			const result = loadAndParseRuleset('bindings/struct/valid_with_properties.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.$requires).toBeUndefined();
		});

		test('parses $capability field', () => {
			const result = loadAndParseRuleset('bindings/struct/valid_with_capability.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.$capability).toBe('spi');
		});

		test('$capability is undefined when not specified', () => {
			const result = loadAndParseRuleset('bindings/struct/valid_minimal.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.$capability).toBeUndefined();
		});
	});

	// A struct field can be filled in by generated code too, not just a descriptor member,
	// and a pointer field can name the sibling holding its length. Both are read by the
	// shared member loop, so a struct sees them.
	describe('readonly and count', () => {
		test('parses readonly on a struct member and its count', () => {
			const result = loadAndParseRuleset('bindings/struct/valid_with_readonly_list.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;

			const devices = binding.properties.find(p => p.name === 'devices') as IncludeProperty;
			expect(devices.readonly).toBe(true);
			expect(devices.count).toBe('nb_devices');

			expect(binding.properties.find(p => p.name === 'nb_devices')?.readonly).toBe(true);
			// Every member goes through the same parse, so an ordinary field says so
			// explicitly rather than being left undefined.
			expect(binding.properties.find(p => p.name === 'name')?.readonly).toBe(false);
		});

		test('rejects a count naming a field the struct does not have', () => {
			const result = loadAndParseRuleset('bindings/struct/count_missing_sibling.yaml');
			expectError(result);
			expectErrorContains(result, "not a field of this struct");
		});

		test('rejects a count naming a non-integer field', () => {
			const result = loadAndParseRuleset('bindings/struct/count_not_integer.yaml');
			expectError(result);
			expectErrorContains(result, "must be an integer field");
		});

		// Otherwise the user could set a length that the generated code then overwrites.
		test('rejects a readonly list whose count is settable', () => {
			const result = loadAndParseRuleset('bindings/struct/count_readonly_mismatch.yaml');
			expectError(result);
			expectErrorContains(result, "must both be readonly or neither");
		});
	});

	describe('error cases', () => {
		test('rejects missing $id', () => {
			const result = loadAndParseRuleset('bindings/struct/missing_id.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field '$id'");
		});

		test('rejects missing $type', () => {
			const result = loadAndParseRuleset('bindings/struct/missing_type.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field '$type'");
		});

		test('rejects missing $symbol', () => {
			const result = loadAndParseRuleset('bindings/struct/missing_symbol.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field '$symbol'");
		});

		test('rejects missing $sources', () => {
			const result = loadAndParseRuleset('bindings/struct/missing_sources.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field '$sources'");
		});

		test('rejects missing $ranking', () => {
			const result = loadAndParseRuleset('bindings/struct/missing_ranking.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field '$ranking'");
		});

		test('rejects invalid $ranking value', () => {
			const result = loadAndParseRuleset('bindings/struct/invalid_ranking.yaml');
			expectError(result);
			expectErrorPath(result, '$ranking');
			expectErrorContains(result, 'invalid');
		});
	});
});
