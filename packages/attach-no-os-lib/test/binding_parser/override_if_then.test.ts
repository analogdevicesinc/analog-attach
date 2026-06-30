import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { RulesetStruct } from '../../src/ruleset_parser/types';

describe('OverrideIfThen parsing', () => {
	describe('valid cases', () => {
		test('parses basic if/then override', () => {
			const result = loadAndParseRuleset('overrides/if_then/valid_basic.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.$override).toBeDefined();
			expect(binding.$override).toHaveLength(1);
			expect(binding.$override![0]._t).toBe('OverrideIfThen');
		});

		test('parses if/then with explicit scope', () => {
			const result = loadAndParseRuleset('overrides/if_then/valid_with_scopes.yaml');
			expectOk(result);
			const binding = result.value as RulesetStruct;
			expect(binding.$override![0]._t).toBe('OverrideIfThen');
		});
	});

	describe('error cases', () => {
		test('rejects missing $then', () => {
			const result = loadAndParseRuleset('overrides/if_then/missing_then.yaml');
			expectError(result);
			expectErrorContains(result, 'Expected object');
		});

		test('rejects condition missing value field', () => {
			const result = loadAndParseRuleset('overrides/if_then/condition_missing_value.yaml');
			expectError(result);
			expectErrorContains(result, "'value' field");
		});

		test('rejects multiple conditions in $if', () => {
			const result = loadAndParseRuleset('overrides/if_then/multiple_conditions.yaml');
			expectError(result);
			expectErrorContains(result, 'exactly one property condition');
		});
	});
});
