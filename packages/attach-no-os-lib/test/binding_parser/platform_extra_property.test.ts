import { describe, test, expect } from 'vitest';
import { expectOk, expectError, expectErrorContains, loadAndParseProperty } from '../test_utils';
import { PlatformExtraProperty } from '../../src/bindings_parser/types';

describe('PlatformExtraProperty parsing', () => {
	describe('valid cases', () => {
		test('parses basic platform_extra', () => {
			const result = loadAndParseProperty('properties/platform_extra/valid_basic.yaml');
			expectOk(result);
			expect(result.value._t).toBe('PlatformExtraProperty');
			const prop = result.value as PlatformExtraProperty;
			expect(prop.platforms).toHaveLength(2);
		});
	});

	describe('error cases', () => {
		test('rejects missing platforms', () => {
			const result = loadAndParseProperty('properties/platform_extra/missing_platforms.yaml');
			expectError(result);
			expectErrorContains(result, "Missing required field 'platforms'");
		});
	});
});
