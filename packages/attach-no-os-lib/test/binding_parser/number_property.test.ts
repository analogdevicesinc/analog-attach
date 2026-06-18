import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utils';
import { NumberProperty } from '../../src/bindings_parser/types';

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
			const prop = result.value as NumberProperty;
			expect(prop.type).toBe('uint8_t');
			expect(prop.minimum).toBe(0);
			expect(prop.maximum).toBe(255);
		});

		test('parses with default value', () => {
			const result = loadAndParseProperty('properties/number/valid_with_default.yaml');
			expectOk(result);
			const prop = result.value as NumberProperty;
			expect(prop.type).toBe('uint16_t');
			expect(prop.default).toBe(100);
		});

		test('parses with all options', () => {
			const result = loadAndParseProperty('properties/number/valid_with_all_options.yaml');
			expectOk(result);
			const prop = result.value as NumberProperty;
			expect(prop.type).toBe('uint32_t');
			expect(prop.description).toBe('A fully configured number property');
			expect(prop.required).toBe(true);
			expect(prop.default).toBe(42);
			expect(prop.minimum).toBe(0);
			expect(prop.maximum).toBe(1000);
		});

		test('parses size_t type', () => {
			const result = loadAndParseProperty('properties/number/valid_size_t.yaml');
			expectOk(result);
			expect((result.value as NumberProperty).type).toBe('size_t');
		});

		test('parses with capability', () => {
			const result = loadAndParseProperty('properties/number/valid_with_capability.yaml');
			expectOk(result);
			const prop = result.value as NumberProperty;
			expect(prop.capability).toEqual(['dma']);
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
	});
});
