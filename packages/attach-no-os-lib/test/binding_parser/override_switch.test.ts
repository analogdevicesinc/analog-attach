import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { RulesetStruct } from '../../src/ruleset_parser/types';

describe('OverrideSwitch parsing', () => {
	describe('valid cases', () => {
		test('parses basic switch override', () => {
			const result = loadAndParseRuleset('overrides/switch/valid_basic.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.$override).toBeDefined();
			expect(ruleset.$override).toHaveLength(1);
			expect(ruleset.$override![0]._t).toBe('OverrideSwitch');
		});

		test('parses switch with parent scope', () => {
			const result = loadAndParseRuleset('overrides/switch/valid_with_parent_scope.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.$override).toBeDefined();
			expect(ruleset.$override![0]._t).toBe('OverrideSwitch');
			expect(ruleset.$override![0].scope).toBe('$parent');
		});
	});

	describe('error cases', () => {
		test('rejects missing $on', () => {
			const result = loadAndParseRuleset('overrides/switch/missing_on.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field '$on'");
		});

		test('rejects missing $cases', () => {
			const result = loadAndParseRuleset('overrides/switch/missing_cases.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field '$cases'");
		});

		test('rejects invalid case name', () => {
			const result = loadAndParseRuleset('overrides/switch/invalid_case_name.yaml');
			expectError(result);
			expectErrorContains(result, "Invalid case 'C'");
		});

		test('rejects unknown property in $on', () => {
			const result = loadAndParseRuleset('overrides/switch/unknown_property.yaml');
			expectError(result);
			expectErrorContains(result, "Unknown property 'unknown_prop'");
		});
	});
});
