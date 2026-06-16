import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utils';
import { IncludeProperty } from '../../src/bindings_parser/types';

describe('IncludeProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic include', () => {
			const result = loadAndParseProperty('properties/include/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('IncludeProperty');
			const prop = result.value as IncludeProperty;
			expect(prop.include).toBe('path/to/other.yaml');
			expect(prop.pointer).toBe(false);
		});

		test('parses with pointer', () => {
			const result = loadAndParseProperty('properties/include/valid_with_pointer.yaml');
			expectOk(result);
			const prop = result.value as IncludeProperty;
			expect(prop.include).toBe('path/to/struct.yaml');
			expect(prop.pointer).toBe(true);
			expect(prop.description).toBe('Pointer to external struct');
		});
	});

	describe('error cases', () => {
		test('rejects missing include field', () => {
			const result = loadAndParseProperty('properties/include/missing_include.yaml');
			expectError(result);
			expectErrorContains(result, 'Cannot determine the property type');
		});

		test('rejects include not being a string', () => {
			const result = loadAndParseProperty('properties/include/include_not_string.yaml');
			expectError(result);
			expectErrorPath(result, 'include');
			expectErrorContains(result, 'Expected string');
		});
	});
});
