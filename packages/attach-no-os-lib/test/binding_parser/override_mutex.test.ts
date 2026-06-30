import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { RulesetStruct } from '../../src/ruleset_parser/types';

describe('OverrideMutex parsing', () => {
	describe('valid cases', () => {
		test('parses mutex with two properties', () => {
			const result = loadAndParseRuleset('overrides/mutex/valid_two_props.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.$override).toBeDefined();
			expect(ruleset.$override).toHaveLength(1);
			expect(ruleset.$override![0]._t).toBe('OverrideMutex');
		});

		test('parses mutex with multiple properties', () => {
			const result = loadAndParseRuleset('overrides/mutex/valid_multiple_props.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.$override![0]._t).toBe('OverrideMutex');
		});
	});

	describe('error cases', () => {
		test('rejects $mutex not being an array', () => {
			const result = loadAndParseRuleset('overrides/mutex/mutex_not_array.yaml');
			expectError(result);
			expectErrorContains(result, '$mutex must be an array');
		});

		test('rejects $mutex with only one property', () => {
			const result = loadAndParseRuleset('overrides/mutex/mutex_one_prop.yaml');
			expectError(result);
			expectErrorContains(result, 'at least 2 properties');
		});

		test('rejects unknown property in mutex', () => {
			const result = loadAndParseRuleset('overrides/mutex/mutex_unknown_prop.yaml');
			expectError(result);
			expectErrorContains(result, "Unknown property 'unknown_prop'");
		});
	});
});
