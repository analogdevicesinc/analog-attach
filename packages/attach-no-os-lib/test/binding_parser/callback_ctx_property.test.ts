import { describe, test, expect } from 'vitest';
import { expectOk, loadAndParseProperty } from '../test_utils';
import { CallbackContextProperty } from '../../src/bindings_parser/types';

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
			const prop = result.value as CallbackContextProperty;
			expect(prop.default).toBe('NULL');
			expect(prop.description).toBe('User context pointer');
		});
	});
});
