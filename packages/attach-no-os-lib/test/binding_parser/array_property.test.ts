import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utilities';
import { ArrayProperty } from '../../src/ruleset_parser/types';

describe('ArrayProperty parsing', () => {
	describe('valid cases', () => {
		test('parses with number element', () => {
			const result = loadAndParseProperty('properties/array/valid_number_element.yaml');
			expectOk(result);
			expect(result.value._t).toBe('ArrayProperty');
			const property = result.value as ArrayProperty;
			expect(property.size).toBe(10);
			expect(property.element._t).toBe('NumberProperty');
		});

		test('parses with bool element', () => {
			const result = loadAndParseProperty('properties/array/valid_bool_element.yaml');
			expectOk(result);
			const property = result.value as ArrayProperty;
			expect(property.size).toBe(4);
			expect(property.element._t).toBe('BooleanProperty');
		});

		test('parses with enum element', () => {
			const result = loadAndParseProperty('properties/array/valid_enum_element.yaml');
			expectOk(result);
			const property = result.value as ArrayProperty;
			expect(property.size).toBe(8);
			expect(property.element._t).toBe('EnumProperty');
		});

		test('parses with include element', () => {
			const result = loadAndParseProperty('properties/array/valid_include_element.yaml');
			expectOk(result);
			const property = result.value as ArrayProperty;
			expect(property.size).toBe(16);
			expect(property.element._t).toBe('IncludeProperty');
		});

		test('parses with disabled flag', () => {
			const result = loadAndParseProperty('properties/array/valid_with_disabled.yaml');
			expectOk(result);
			const property = result.value as ArrayProperty;
			expect(property.disabled).toBe(true);
		});
	});

	describe('error cases', () => {
		test('rejects missing size', () => {
			const result = loadAndParseProperty('properties/array/missing_size.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'size'");
		});

		test('rejects missing element', () => {
			const result = loadAndParseProperty('properties/array/missing_element.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'element'");
		});

		test('rejects size not being a number', () => {
			const result = loadAndParseProperty('properties/array/size_not_number.yaml');
			expectError(result);
			expectErrorPath(result, 'size');
			expectErrorContains(result, 'Expected number');
		});

		test('rejects element with invalid type', () => {
			const result = loadAndParseProperty('properties/array/element_invalid_type.yaml');
			expectError(result);
			expectErrorContains(result, 'Invalid element type');
		});

		test('rejects element without type or include', () => {
			const result = loadAndParseProperty('properties/array/element_no_type_or_include.yaml');
			expectError(result);
			expectErrorContains(result, "must have either 'type' or 'include'");
		});
	});
});
