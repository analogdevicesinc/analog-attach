import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utils';
import { StringProperty } from '../../src/bindings_parser/types';

describe('StringProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic string', () => {
			const result = loadAndParseProperty('properties/string/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('StringProperty');
			expect((result.value as StringProperty).type).toBe('string');
		});

		test('parses with default value', () => {
			const result = loadAndParseProperty('properties/string/valid_with_default.yaml');
			expectOk(result);
			const prop = result.value as StringProperty;
			expect(prop.default).toBe('hello');
			expect(prop.description).toBe('A string with default');
		});
	});

	describe('error cases', () => {
		test('rejects default not being a string', () => {
			const result = loadAndParseProperty('properties/string/default_not_string.yaml');
			expectError(result);
			expectErrorPath(result, 'default');
			expectErrorContains(result, 'Expected string');
		});
	});
});
