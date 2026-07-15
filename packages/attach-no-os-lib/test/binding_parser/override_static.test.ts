import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { RulesetStruct } from '../../src/ruleset_parser/types';

// A static override (no $if/$switch/$mutex) lowers to a single always-rule whose
// effects are the lowered property overrides.
describe('static override lowering', () => {
	describe('valid cases', () => {
		test('parses basic static override', () => {
			const result = loadAndParseRuleset('overrides/static/valid_basic.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules).toBeDefined();
			expect(ruleset.rules).toHaveLength(1);
			expect(ruleset.rules![0].when._t).toBe('PredicateAlways');
		});

		test('lowers number property override to set effects', () => {
			const result = loadAndParseRuleset('overrides/static/valid_number_override.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			const ops = ruleset.rules![0].effects.map(effect => effect.op);
			expect(ops).toContain('setMin');
			expect(ops).toContain('setMax');
			expect(ops).toContain('setDefault');
		});

		test('lowers enum property override with default', () => {
			const result = loadAndParseRuleset('overrides/static/valid_enum_override.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules![0].effects.some(effect => effect.op === 'setDefault')).toBe(true);
		});

		test('lowers enum property override with values to restrictValues', () => {
			const result = loadAndParseRuleset('overrides/static/valid_enum_values_override.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules![0].effects.some(effect => effect.op === 'restrictValues')).toBe(true);
		});

		test('lowers boolean property override with default', () => {
			const result = loadAndParseRuleset('overrides/static/valid_bool_override.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules![0].effects.some(effect => effect.op === 'setDefault')).toBe(true);
		});

		test('lowers include property override with pointer to setPointer', () => {
			const result = loadAndParseRuleset('overrides/static/valid_include_override.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules![0].effects.some(effect => effect.op === 'setPointer')).toBe(true);
		});

		test('lowers union property override with value to selectMember', () => {
			const result = loadAndParseRuleset('overrides/static/valid_union_override.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules![0].effects.some(effect => effect.op === 'selectMember')).toBe(true);
		});

		test('allows multiple property keys in one static override', () => {
			// The new model has no single-target limit: multiple keys lower to one
			// always-rule carrying one effect per key.
			const result = loadAndParseRuleset('overrides/static/multiple_keys.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetStruct;
			expect(ruleset.rules).toHaveLength(1);
			expect(ruleset.rules![0].effects.length).toBe(2);
		});
	});

	describe('error cases', () => {
		test('rejects unknown property', () => {
			const result = loadAndParseRuleset('overrides/static/unknown_property.yaml');
			expectError(result);
			expectErrorContains(result, "Unknown property 'unknown_prop'");
		});

		test('rejects number override with minimum below type minimum', () => {
			const result = loadAndParseRuleset('overrides/static/invalid_number_minimum.yaml');
			expectError(result);
			expectErrorContains(result, 'below type minimum');
		});

		test('rejects number override with maximum above type maximum', () => {
			const result = loadAndParseRuleset('overrides/static/invalid_number_maximum.yaml');
			expectError(result);
			expectErrorContains(result, 'above type maximum');
		});

		test('rejects enum override with invalid default', () => {
			const result = loadAndParseRuleset('overrides/static/invalid_enum_default.yaml');
			expectError(result);
			expectErrorContains(result, "Invalid default 'D'");
		});

		test('rejects union override with invalid member value', () => {
			const result = loadAndParseRuleset('overrides/static/invalid_union_value.yaml');
			expectError(result);
			expectErrorContains(result, "Invalid union member 'uart'");
		});
	});
});
