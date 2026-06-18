import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseBinding } from '../test_utils';
import { RulesetEnum, RulesetType } from '../../src/bindings_parser/types';

describe('BindingEnum parsing', () => {
	describe('valid cases', () => {
		test('parses enum with array values', () => {
			const result = loadAndParseBinding('bindings/enum/valid_array_values.yaml');
			expectOk(result);
			expect(result.value._t).toBe('BindingEnum');
			expect(result.value.$type).toBe(RulesetType.BT_ENUM);
			const binding = result.value as RulesetEnum;
			expect(binding.values).toHaveLength(3);
			expect(binding.values[0].name).toBe('VALUE_A');
		});

		test('parses enum with object values (name: description)', () => {
			const result = loadAndParseBinding('bindings/enum/valid_object_values.yaml');
			expectOk(result);
			const binding = result.value as RulesetEnum;
			expect(binding.values).toHaveLength(3);
			expect(binding.values[0].name).toBe('STATUS_OK');
			expect(binding.values[0].description).toBe('Operation succeeded');
		});

		test('parses enum with nested description objects', () => {
			const result = loadAndParseBinding('bindings/enum/valid_nested_description.yaml');
			expectOk(result);
			const binding = result.value as RulesetEnum;
			expect(binding.values).toHaveLength(2);
			expect(binding.values[0].description).toBe('First option with detailed description');
		});

		test('parses enum with default value', () => {
			const result = loadAndParseBinding('bindings/enum/valid_with_default.yaml');
			expectOk(result);
			const binding = result.value as RulesetEnum;
			expect(binding.default).toBe('MODE_B');
		});
	});

	describe('error cases', () => {
		test('rejects missing values', () => {
			const result = loadAndParseBinding('bindings/enum/missing_values.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'values'");
		});

		test('rejects default not in values', () => {
			const result = loadAndParseBinding('bindings/enum/default_not_in_values.yaml');
			expectError(result);
			expectErrorPath(result, 'default');
			expectErrorContains(result, 'not a valid enum value');
		});
	});
});
