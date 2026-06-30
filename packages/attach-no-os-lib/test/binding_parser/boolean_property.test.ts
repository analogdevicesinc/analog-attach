import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorPath, expectErrorContains, loadAndParseProperty } from '../test_utilities';
import { BooleanProperty } from '../../src/ruleset_parser/types';

describe('BooleanProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic bool', () => {
			const result = loadAndParseProperty('properties/boolean/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('BooleanProperty');
			expect((result.value as BooleanProperty).type).toBe('bool');
			expect((result.value as BooleanProperty).default).toBe(false);
		});

		test('parses with default true', () => {
			const result = loadAndParseProperty('properties/boolean/valid_default_true.yaml');
			expectOk(result);
			expect((result.value as BooleanProperty).default).toBe(true);
		});

		test('parses with required', () => {
			const result = loadAndParseProperty('properties/boolean/valid_with_required.yaml');
			expectOk(result);
			const property = result.value as BooleanProperty;
			expect(property.required).toBe(true);
			expect(property.description).toBe('A required boolean');
		});
	});

	describe('error cases', () => {
		test('rejects default not being a boolean', () => {
			const result = loadAndParseProperty('properties/boolean/default_not_bool.yaml');
			expectError(result);
			expectErrorPath(result, 'default');
			expectErrorContains(result, 'Expected boolean');
		});
	});
});
