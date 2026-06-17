import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utils';
import { EnumProperty } from '../../src/bindings_parser/types';

describe('EnumProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic enum with values', () => {
			const result = loadAndParseProperty('properties/enum/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('EnumProperty');
			const prop = result.value as EnumProperty;
			expect(prop.values).toEqual(['VALUE_A', 'VALUE_B', 'VALUE_C']);
		});

		test('parses with default value', () => {
			const result = loadAndParseProperty('properties/enum/valid_with_default.yaml');
			expectOk(result);
			const prop = result.value as EnumProperty;
			expect(prop.values).toEqual(['OPTION_1', 'OPTION_2', 'OPTION_3']);
			expect(prop.default).toBe('OPTION_2');
		});

		test('parses with description and required', () => {
			const result = loadAndParseProperty('properties/enum/valid_with_description.yaml');
			expectOk(result);
			const prop = result.value as EnumProperty;
			expect(prop.description).toBe('Operation mode selector');
			expect(prop.required).toBe(true);
		});

		test('parses enum with number values', () => {
			const result = loadAndParseProperty('properties/enum/valid_number_values.yaml');
			expectOk(result);
			const prop = result.value as EnumProperty;
			expect(prop.values).toEqual([0, 1, 2, 3]);
		});

		test('parses enum with number values and default', () => {
			const result = loadAndParseProperty('properties/enum/valid_number_with_default.yaml');
			expectOk(result);
			const prop = result.value as EnumProperty;
			expect(prop.values).toEqual([100, 200, 300]);
			expect(prop.default).toBe(200);
		});

		test('parses enum with mixed string and number values', () => {
			const result = loadAndParseProperty('properties/enum/valid_mixed_values.yaml');
			expectOk(result);
			const prop = result.value as EnumProperty;
			expect(prop.values).toEqual(['AUTO', 0, 1, 2]);
			expect(prop.default).toBe('AUTO');
		});
	});

	describe('error cases', () => {
		test('rejects missing values field', () => {
			const result = loadAndParseProperty('properties/enum/missing_values.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'values'");
		});

		test('rejects values not being an array', () => {
			const result = loadAndParseProperty('properties/enum/values_not_array.yaml');
			expectError(result);
			expectErrorPath(result, 'values');
			expectErrorContains(result, 'Expected array');
		});

		test('rejects default not in values', () => {
			const result = loadAndParseProperty('properties/enum/default_not_in_values.yaml');
			expectError(result);
			expectErrorPath(result, 'default');
			expectErrorContains(result, "not present in the 'values' field");
		});

		test('rejects number default not in number values', () => {
			const result = loadAndParseProperty('properties/enum/number_default_not_in_values.yaml');
			expectError(result);
			expectErrorPath(result, 'default');
			expectErrorContains(result, "not present in the 'values' field");
		});
	});
});
