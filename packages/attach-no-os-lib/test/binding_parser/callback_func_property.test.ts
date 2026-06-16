import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseProperty } from '../test_utils';
import { CallbackFunctionProperty } from '../../src/bindings_parser/types';

describe('CallbackFunctionProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic callback_func', () => {
			const result = loadAndParseProperty('properties/callback_func/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('CallbackFunctionProperty');
			const prop = result.value as CallbackFunctionProperty;
			expect(prop.signature).toBe('int (*)(void *ctx, uint8_t *data, size_t len)');
		});

		test('parses with default', () => {
			const result = loadAndParseProperty('properties/callback_func/valid_with_default.yaml');
			expectOk(result);
			const prop = result.value as CallbackFunctionProperty;
			expect(prop.default).toBe('NULL');
			expect(prop.description).toBe('Optional callback');
		});
	});

	describe('error cases', () => {
		test('rejects missing signature', () => {
			const result = loadAndParseProperty('properties/callback_func/missing_signature.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'signature'");
		});
	});
});
