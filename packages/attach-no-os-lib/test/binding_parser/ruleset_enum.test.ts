import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseRuleset } from '../test_utilities';
import { RulesetEnum, RulesetType } from '../../src/ruleset_parser/types';

describe('RulesetEnum parsing', () => {
	describe('valid cases', () => {
		test('parses enum with array values', () => {
			const result = loadAndParseRuleset('bindings/enum/valid_array_values.yaml');
			expectOk(result);
			expect(result.value._t).toBe('RulesetEnum');
			expect(result.value.$type).toBe(RulesetType.RT_ENUM);
			const ruleset = result.value as RulesetEnum;
			expect(ruleset.values).toHaveLength(3);
			expect(ruleset.values[0].name).toBe('VALUE_A');
		});

		test('parses enum with object values (name: description)', () => {
			const result = loadAndParseRuleset('bindings/enum/valid_object_values.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetEnum;
			expect(ruleset.values).toHaveLength(3);
			expect(ruleset.values[0].name).toBe('STATUS_OK');
			expect(ruleset.values[0].description).toBe('Operation succeeded');
		});

		test('parses enum with nested description objects', () => {
			const result = loadAndParseRuleset('bindings/enum/valid_nested_description.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetEnum;
			expect(ruleset.values).toHaveLength(2);
			expect(ruleset.values[0].description).toBe('First option with detailed description');
		});

		test('parses enum with default value', () => {
			const result = loadAndParseRuleset('bindings/enum/valid_with_default.yaml');
			expectOk(result);
			const ruleset = result.value as RulesetEnum;
			expect(ruleset.default).toBe('MODE_B');
		});
	});

	describe('error cases', () => {
		test('rejects missing values', () => {
			const result = loadAndParseRuleset('bindings/enum/missing_values.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'values'");
		});

		test('rejects default not in values', () => {
			const result = loadAndParseRuleset('bindings/enum/default_not_in_values.yaml');
			expectError(result);
			expectErrorPath(result, 'default');
			expectErrorContains(result, 'not a valid enum value');
		});
	});
});
