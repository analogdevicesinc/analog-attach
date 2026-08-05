import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { RulesetStruct } from '../../src/ruleset_parser/types';

// $switch fans out to one PredicateEquals rule per case, all sharing the $on ref.
// No switch construct survives lowering.
describe('switch override lowering', () => {
	describe('valid cases', () => {
		test('fans out cases to equals-rules', () => {
			const result = loadAndParseRuleset('overrides/switch/valid_basic.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules).toBeDefined();
			expect(ruleset.rules!.length).toBeGreaterThanOrEqual(1);
			expect(ruleset.rules!.every(r => r.when._t === 'PredicateEquals')).toBe(true);
		});

		// YAML hands back every mapping key as a string, but the workfile stores a
		// uint32_t answer as a number and the engine compares with strict ===. Numeric
		// case names must therefore arrive as numbers or the case can never fire.
		test('lowers numeric case names to numbers', () => {
			const result = loadAndParseRuleset('overrides/switch/valid_numeric_cases.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const values = ruleset.rules!.map(r => r.when._t === 'PredicateEquals' ? r.when.value : undefined);
			expect(values).toEqual([0, 1]);
		});

		test('lowers numeric case names for a numeric-valued enum', () => {
			const result = loadAndParseRuleset('overrides/switch/valid_numeric_enum_cases.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const values = ruleset.rules!.map(r => r.when._t === 'PredicateEquals' ? r.when.value : undefined);
			expect(values).toEqual([0, 1]);
		});

		test('keeps non-numeric case names as authored', () => {
			const result = loadAndParseRuleset('overrides/switch/valid_basic.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const values = ruleset.rules!.map(r => r.when._t === 'PredicateEquals' ? r.when.value : undefined);
			expect(values).toEqual(['SPI', 'I2C']);
		});

		test('lowers `_` to a none-of over the sibling case values', () => {
			const result = loadAndParseRuleset('overrides/switch/valid_default_case.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules!.map(r => r.when._t)).toEqual(['PredicateEquals', 'PredicateNoneOf']);
			const fallback = ruleset.rules![1].when;
			if (fallback._t === 'PredicateNoneOf') {
				expect(fallback.values).toEqual(['SPI']);
			}
		});

		test('parent-scope switch resolves condition ref to parent', () => {
			const result = loadAndParseRuleset('overrides/switch/valid_with_parent_scope.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const when = ruleset.rules![0].when;
			expect(when._t).toBe('PredicateEquals');
			if (when._t === 'PredicateEquals') {
				expect(when.reference.node).toBe('parent');
			}
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
