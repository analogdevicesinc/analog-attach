import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { RulesetStruct } from '../../src/ruleset_parser/types';

// $mutex is not a special case: [a, b, ...] lowers to one rule per member,
// `when hasValue(member) -> disable every sibling`. So N members -> N rules,
// each with N-1 setDisabled effects.
describe('mutex override lowering', () => {
	describe('valid cases', () => {
		test('lowers mutex with two properties to two disable-rules', () => {
			const result = loadAndParseRuleset('overrides/mutex/valid_two_props.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules).toHaveLength(2);
			expect(ruleset.rules![0].when._t).toBe('PredicateHasValue');
			expect(ruleset.rules![0].effects[0].op).toBe('setDisabled');
		});

		test('lowers mutex with multiple properties', () => {
			const result = loadAndParseRuleset('overrides/mutex/valid_multiple_props.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			// N members -> N rules, each disabling the other N-1.
			const n = ruleset.rules!.length;
			expect(n).toBeGreaterThanOrEqual(3);
			expect(ruleset.rules![0].effects.length).toBe(n - 1);
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
