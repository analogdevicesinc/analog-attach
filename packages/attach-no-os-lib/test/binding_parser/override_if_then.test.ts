import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { RulesetStruct } from '../../src/ruleset_parser/types';

// $if/$then lowers to a single rule whose `when` is the lowered condition and
// whose effects are the lowered $then body.
describe('if/then override lowering', () => {
	describe('valid cases', () => {
		test('parses basic if/then override', () => {
			const result = loadAndParseRuleset('overrides/if_then/valid_basic.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.rules).toBeDefined();
			expect(binding.rules).toHaveLength(1);
			expect(binding.rules![0].when._t).toBe('PredicateEquals');
		});

		test('parses if/then with explicit scope', () => {
			const result = loadAndParseRuleset('overrides/if_then/valid_with_scopes.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.rules![0].when._t).toBe('PredicateEquals');
		});

		test('lowers multiple conditions to PredicateAnd', () => {
			// The new model supports multi-key $if conditions via PredicateAnd.
			const result = loadAndParseRuleset('overrides/if_then/multiple_conditions.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.rules![0].when._t).toBe('PredicateAnd');
		});
	});

	describe('error cases', () => {
		test('rejects missing $then', () => {
			const result = loadAndParseRuleset('overrides/if_then/missing_then.yaml');
			expectError(result);
			expectErrorContains(result, 'Expected object');
		});

		test('rejects condition with unknown operator', () => {
			const result = loadAndParseRuleset('overrides/if_then/condition_missing_value.yaml');
			expectError(result);
			expectErrorContains(result, 'Unknown condition operator');
		});
	});
});
