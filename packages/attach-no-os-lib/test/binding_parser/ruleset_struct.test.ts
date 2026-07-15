import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { RulesetStruct, RulesetType } from '../../src/ruleset_parser/types';

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
