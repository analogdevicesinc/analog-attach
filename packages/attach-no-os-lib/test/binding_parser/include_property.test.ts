import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utilities';
import { IncludeProperty, RulesetType } from '../../src/ruleset_parser/types';

describe('IncludeProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic include', () => {
			const result = loadAndParseProperty('properties/include/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('IncludeProperty');
			const property = result.value as IncludeProperty;
			expect(property.include).toBe('path/to/other.yaml');
			expect(property.pointer).toBe(false);
		});

		test('parses with pointer', () => {
			const result = loadAndParseProperty('properties/include/valid_with_pointer.yaml');
			expectOk(result);
			const property = result.value as IncludeProperty;
			expect(property.include).toBe('path/to/struct.yaml');
			expect(property.pointer).toBe(true);
			expect(property.description).toBe('Pointer to external struct');
		});

		test('parses count', () => {
			const result = loadAndParseProperty('properties/include/valid_with_count.yaml');
			expectOk(result);
			const property = result.value as IncludeProperty;
			expect(property.pointer).toBe(true);
			expect(property.count).toBe('nb_elements');
		});

		test('count is undefined when not specified', () => {
			const result = loadAndParseProperty('properties/include/valid_with_pointer.yaml');
			expectOk(result);
			expect((result.value as IncludeProperty).count).toBeUndefined();
		});

		test('parses include_type', () => {
			const result = loadAndParseProperty('properties/include/valid_include_type.yaml');
			expectOk(result);
			expect(result.value._t).toBe('IncludeProperty');
			const property = result.value as IncludeProperty;
			expect(property.include).toBeUndefined();
			expect(property.include_type).toBe(RulesetType.RT_DESCRIPTOR);
			expect(property.pointer).toBe(true);
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

		test('rejects include and include_type together', () => {
			const result = loadAndParseProperty('properties/include/include_type_conflict.yaml');
			expectError(result);
			expectErrorContains(result, 'mutually exclusive');
		});

		// A by-value member is one element, so a length beside it would be meaningless.
		test('rejects count without pointer', () => {
			const result = loadAndParseProperty('properties/include/count_without_pointer.yaml');
			expectError(result);
			expectErrorPath(result, 'count');
			expectErrorContains(result, "needs 'pointer: true'");
		});

		test('rejects an unknown include_type', () => {
			const result = loadAndParseProperty('properties/include/include_type_unknown.yaml');
			expectError(result);
			expectErrorPath(result, 'include_type');
			expectErrorContains(result, "Invalid include_type 'banana'");
		});
	});
});
