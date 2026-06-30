import { describe, test, expect } from 'vitest';
import { expectOk, loadAndParseProperty } from '../test_utilities';
import { CallbackContextProperty } from '../../src/ruleset_parser/types';

describe('CallbackContextProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic callback_ctx', () => {
			const result = loadAndParseProperty('properties/callback_ctx/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('CallbackContextProperty');
		});

		test('parses with default', () => {
			const result = loadAndParseProperty('properties/callback_ctx/valid_with_default.yaml');
			expectOk(result);
			const property = result.value as CallbackContextProperty;
			expect(property.default).toBe('NULL');
			expect(property.description).toBe('User context pointer');
		});
	});
});
