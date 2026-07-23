import { describe, test, expect } from 'vitest';
import { expectOk, loadAndParseProperty } from '../test_utilities';
import { RawProperty } from '../../src/ruleset_parser/types';

describe('RawProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic raw', () => {
			const result = loadAndParseProperty('properties/raw/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('RawProperty');
			const property = result.value as RawProperty;
			expect(property.type).toBe('raw');
			expect(property.required).toBe(false);
			expect(property.default).toBeUndefined();
		});

		test('parses with default and required', () => {
			const result = loadAndParseProperty('properties/raw/valid_with_default.yaml');
			expectOk(result);
			const property = result.value as RawProperty;
			expect(property.default).toBe('NULL');
			expect(property.description).toBe('User context pointer');
			expect(property.required).toBe(true);
		});
	});
});
