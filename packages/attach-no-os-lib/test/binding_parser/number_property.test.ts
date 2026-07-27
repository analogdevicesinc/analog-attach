import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utilities';
import { NumberProperty } from '../../src/ruleset_parser/types';

describe('NumberProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic uint8_t', () => {
			const result = loadAndParseProperty('properties/number/valid_uint8.yaml');
			expectOk(result);
			expect(result.value._t).toBe('NumberProperty');
			expect((result.value as NumberProperty).type).toBe('uint8_t');
		});

		test('parses int32_t', () => {
			const result = loadAndParseProperty('properties/number/valid_int32.yaml');
			expectOk(result);
			expect(result.value._t).toBe('NumberProperty');
			expect((result.value as NumberProperty).type).toBe('int32_t');
		});

		test('parses with minimum and maximum', () => {
			const result = loadAndParseProperty('properties/number/valid_with_min_max.yaml');
			expectOk(result);
			const property = result.value as NumberProperty;
			expect(property.type).toBe('uint8_t');
			expect(property.minimum).toBe(0);
			expect(property.maximum).toBe(255);
		});

		test('parses with default value', () => {
			const result = loadAndParseProperty('properties/number/valid_with_default.yaml');
			expectOk(result);
			const property = result.value as NumberProperty;
			expect(property.type).toBe('uint16_t');
			expect(property.default).toBe(100);
		});

		test('parses with all options', () => {
			const result = loadAndParseProperty('properties/number/valid_with_all_options.yaml');
			expectOk(result);
			const property = result.value as NumberProperty;
			expect(property.type).toBe('uint32_t');
			expect(property.description).toBe('A fully configured number property');
			expect(property.required).toBe(true);
			expect(property.default).toBe(42);
			expect(property.minimum).toBe(0);
			expect(property.maximum).toBe(1000);
		});

		test('parses size_t type', () => {
			const result = loadAndParseProperty('properties/number/valid_size_t.yaml');
			expectOk(result);
			expect((result.value as NumberProperty).type).toBe('size_t');
		});

		test('parses with capability', () => {
			const result = loadAndParseProperty('properties/number/valid_with_capability.yaml');
			expectOk(result);
			const property = result.value as NumberProperty;
			expect(property.capability).toEqual(['dma']);
		});

		test('parses float type', () => {
			const result = loadAndParseProperty('properties/number/valid_float.yaml');
			expectOk(result);
			expect(result.value._t).toBe('NumberProperty');
			expect((result.value as NumberProperty).type).toBe('float');
		});

		test('parses double type', () => {
			const result = loadAndParseProperty('properties/number/valid_double.yaml');
			expectOk(result);
			expect(result.value._t).toBe('NumberProperty');
			expect((result.value as NumberProperty).type).toBe('double');
		});

		test('parses fractional default on a double', () => {
			const result = loadAndParseProperty('properties/number/valid_double_with_default.yaml');
			expectOk(result);
			expect((result.value as NumberProperty).default).toBe(3.3);
		});

		test('parses float with fractional default and bounds', () => {
			const result = loadAndParseProperty('properties/number/valid_float_with_all_options.yaml');
			expectOk(result);
			const property = result.value as NumberProperty;
			expect(property.type).toBe('float');
			expect(property.description).toBe('Sample rate in Hz');
			expect(property.required).toBe(true);
			expect(property.default).toBe(1000.5);
			expect(property.minimum).toBe(0.1);
			expect(property.maximum).toBe(51_200);
		});
	});

	describe('error cases', () => {
		test('rejects invalid type', () => {
			const result = loadAndParseProperty('properties/number/invalid_type.yaml');
			expectError(result);
			expectErrorContains(result, 'Unknown property type');
		});

		test('rejects type not being a string', () => {
			const result = loadAndParseProperty('properties/number/type_not_string.yaml');
			expectError(result);
			expectErrorContains(result, 'Cannot determine the property type');
		});

		test('rejects default not being a number', () => {
			const result = loadAndParseProperty('properties/number/default_not_number.yaml');
			expectError(result);
			expectErrorPath(result, 'default');
			expectErrorContains(result, 'Expected number');
		});

		test('rejects minimum not being a number', () => {
			const result = loadAndParseProperty('properties/number/minimum_not_number.yaml');
			expectError(result);
			expectErrorPath(result, 'minimum');
			expectErrorContains(result, 'Expected number');
		});

		test('rejects fractional default on an integer type', () => {
			const result = loadAndParseProperty('properties/number/default_fractional_int.yaml');
			expectError(result);
			expectErrorPath(result, 'default');
			expectErrorContains(result, 'Expected an integer');
		});

		test('rejects fractional minimum on an integer type', () => {
			const result = loadAndParseProperty('properties/number/minimum_fractional_int.yaml');
			expectError(result);
			expectErrorPath(result, 'minimum');
			expectErrorContains(result, 'Expected an integer');
		});

		test('rejects fractional maximum on an integer type', () => {
			const result = loadAndParseProperty('properties/number/maximum_fractional_int.yaml');
			expectError(result);
			expectErrorPath(result, 'maximum');
			expectErrorContains(result, 'Expected an integer');
		});
	});
});
